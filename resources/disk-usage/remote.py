# Janus Disk Usage remote helper. Python 3.8+.
# This source is base64-wrapped by the app and executed by a fixed bootstrap:
#   run(request, should_stop, emit)
# - request: dict from the app ('scan' or 'delete')
# - should_stop: callable returning True when cancellation was requested
# - emit: callable(dict) writing one NDJSON line to stdout
# Never builds shell commands; all filesystem work uses os APIs.

import json
import os
import stat as statmod
import sys
import time

VERSION = 1
MAX_DEPTH = 512
MAX_WARNINGS = 1000
TICK_EVERY = 200
PROGRESS_INTERVAL = 0.25
NODE_BATCH = 256

# Pseudo filesystems skipped when the scan root is "/".
SKIP_AT_ROOT = {'/proc', '/sys', '/dev', '/run'}


def _has_surrogate(s):
    return any(0xD800 <= ord(c) <= 0xDFFF for c in s)


def _kind_of(mode, is_link):
    if is_link:
        return 'symlink'
    if statmod.S_ISDIR(mode):
        return 'directory'
    if statmod.S_ISREG(mode):
        return 'file'
    return 'other'


class Scanner:
    def __init__(self, request, should_stop, emit):
        self.request = request
        self.should_stop = should_stop
        self.emit = emit
        self.max_nodes = int(request.get('maxNodes', 200000))
        self.stay_on_fs = bool(request.get('stayOnFilesystem', True))
        self.nodes_seen = 0
        self.scanned_files = 0
        self.scanned_dirs = 0
        self.known_bytes = 0
        self.warning_count = 0
        self.warnings_sent = 0
        self.ticks = 0
        self.last_progress = 0.0
        self.next_id = 1
        self.batch = []
        self.seq = 0
        self.mounts = set()
        # nodeId -> [totalBytes, fileCount, childCount, issueCount]
        self.sums = {}

    def new_id(self):
        nid = str(self.next_id)
        self.next_id += 1
        return nid

    def warn(self, code, path, message):
        self.warning_count += 1
        if self.warnings_sent < MAX_WARNINGS:
            self.warnings_sent += 1
            self.emit({'type': 'warning', 'code': code, 'path': path, 'message': message})

    def flush_nodes(self):
        if not self.batch:
            return
        self.seq += 1
        self.emit({'type': 'nodes', 'seq': self.seq, 'nodes': self.batch})
        self.batch = []

    def push_node(self, rec):
        self.batch.append(rec)
        self.nodes_seen += 1
        if len(self.batch) >= NODE_BATCH:
            self.flush_nodes()

    def add_child_stats(self, parent_id, nbytes, nfiles, issue):
        s = self.sums.setdefault(parent_id, [0, 0, 0, 0])
        s[0] += nbytes
        s[1] += nfiles
        s[2] += 1  # childCount
        s[3] += issue

    def tick(self, current):
        """Called per entry: throttled progress + cancel check. True = stop."""
        self.ticks += 1
        if self.ticks >= TICK_EVERY:
            self.ticks = 0
            self.progress(current)
            return self.should_stop()
        return False

    def progress(self, current, force=False):
        now = time.monotonic()
        if not force and now - self.last_progress < PROGRESS_INTERVAL:
            return
        self.last_progress = now
        self.emit({
            'type': 'progress',
            'scannedFiles': self.scanned_files,
            'scannedDirs': self.scanned_dirs,
            'knownBytes': self.known_bytes,
            'warningCount': self.warning_count,
            'currentPath': current
        })

    def load_mounts(self, root):
        # Linux nested mount points (incl. same-device bind mounts).
        if not self.stay_on_fs:
            return
        prefix = '/' if root == '/' else root.rstrip('/') + '/'
        try:
            with open('/proc/self/mountinfo', 'r', encoding='utf-8', errors='replace') as fh:
                for line in fh:
                    parts = line.split()
                    if len(parts) >= 5:
                        mp = parts[4].replace('\\040', ' ')
                        if mp != root and mp.startswith(prefix):
                            self.mounts.add(mp)
        except OSError:
            pass

    def close_dir(self, stack, frame):
        """Post-order close: emit aggregated update, propagate to parent."""
        nid = frame['id']
        total, files, childs, issues = self.sums.pop(nid, [0, 0, 0, 0])
        if frame.get('extraIssue'):
            issues += frame['extraIssue']
        coverage = 'partial' if frame.get('partial') else 'complete'
        self.batch.append({
            'id': nid, 'coverage': coverage, 'knownBytes': total,
            'fileCount': files, 'childCount': childs, 'issueCount': issues
        })
        if len(self.batch) >= NODE_BATCH:
            self.flush_nodes()
        if stack:
            parent = stack[-1]['id']
            s = self.sums.setdefault(parent, [0, 0, 0, 0])
            s[0] += total
            s[1] += files
            s[3] += issues
        key = (frame['dev'], frame['ino'])
        self.ancestors.discard(key)
        it = frame.get('it')
        if it is not None:
            try:
                it.close()
            except Exception:
                pass

    def scan(self):
        root_req = self.request['rootPath']
        try:
            root = os.path.realpath(root_req)
        except OSError:
            root = os.path.abspath(root_req)
        try:
            rst = os.lstat(root)
        except FileNotFoundError:
            self.emit({'type': 'terminal', 'state': 'failed', 'errorCode': 'PATH_NOT_FOUND',
                       'error': 'Path not found: %s' % root_req})
            return
        except PermissionError:
            self.emit({'type': 'terminal', 'state': 'failed', 'errorCode': 'PERMISSION_DENIED',
                       'error': 'Permission denied: %s' % root_req})
            return
        if not statmod.S_ISDIR(rst.st_mode):
            self.emit({'type': 'terminal', 'state': 'failed', 'errorCode': 'NOT_DIRECTORY',
                       'error': 'Not a directory: %s' % root})
            return

        root_dev = rst.st_dev
        root_id = self.new_id()
        self.ancestors = {(rst.st_dev, rst.st_ino)}
        self.load_mounts(root)
        self.emit({
            'type': 'hello',
            'python': sys.version.split()[0],
            'rootPath': root,
            'rootNodeId': root_id,
            'rootIdentity': {'dev': str(rst.st_dev), 'ino': str(rst.st_ino)},
            'stayOnFilesystem': self.stay_on_fs,
            'resolvedFrom': root_req if root != root_req else None
        })
        self.sums[root_id] = [0, 0, 0, 0]
        self.push_node({
            'id': root_id, 'parentId': None, 'name': root, 'rel': '',
            'kind': 'directory', 'ownBytes': 0, 'knownBytes': 0,
            'coverage': 'pending', 'childCount': 0, 'fileCount': 0,
            'mtimeMs': int(rst.st_mtime * 1000), 'issueCount': 0,
            'dev': str(rst.st_dev), 'ino': str(rst.st_ino)
        })

        limited = False
        canceled = False
        stack = [{'path': root, 'id': root_id, 'depth': 0, 'dev': rst.st_dev, 'ino': rst.st_ino, 'it': None}]

        while stack:
            if self.should_stop():
                canceled = True
                break
            frame = stack[-1]
            if frame['it'] is None:
                # Enter directory
                self.scanned_dirs += 1
                self.progress(frame['path'])
                if self.nodes_seen >= self.max_nodes:
                    limited = True
                    break
                if frame['depth'] >= MAX_DEPTH:
                    self.warn('depth-limit', frame['path'], 'Maximum depth reached')
                    frame['partial'] = True
                    frame['extraIssue'] = frame.get('extraIssue', 0) + 1
                    frame['it'] = iter(())
                    continue
                try:
                    frame['it'] = os.scandir(frame['path'])
                except PermissionError:
                    self.warn('permission-denied', frame['path'], 'Permission denied')
                    frame['partial'] = True
                    frame['extraIssue'] = frame.get('extraIssue', 0) + 1
                    frame['it'] = iter(())
                except OSError as e:
                    self.warn('read-error', frame['path'], str(e))
                    frame['partial'] = True
                    frame['extraIssue'] = frame.get('extraIssue', 0) + 1
                    frame['it'] = iter(())
                continue

            try:
                entry = next(frame['it'])
            except StopIteration:
                stack.pop()
                self.close_dir(stack, frame)
                continue
            except OSError as e:
                self.warn('read-error', frame['path'], str(e))
                frame['partial'] = True
                frame['extraIssue'] = frame.get('extraIssue', 0) + 1
                stack.pop()
                self.close_dir(stack, frame)
                continue

            if self.tick(frame['path']):
                canceled = True
                break
            if self.nodes_seen >= self.max_nodes:
                limited = True
                break

            full = os.path.join(frame['path'], entry.name)
            rel = full[len(root):].lstrip(os.sep) if full.startswith(root) else full
            try:
                is_link = entry.is_symlink()
                st = entry.stat(follow_symlinks=False)
            except FileNotFoundError:
                self.warn('vanished', full, 'Vanished during scan')
                continue
            except PermissionError:
                self.warn('permission-denied', full, 'Permission denied')
                continue
            except OSError as e:
                self.warn('stat-error', full, str(e))
                continue

            kind = _kind_of(st.st_mode, is_link)
            own = st.st_size if kind == 'file' else 0
            issue = 0
            selectable = True
            if _has_surrogate(entry.name):
                issue += 1
                selectable = False
                self.warn('unsupported-filename', full, 'Non-UTF-8 filename')

            if kind == 'directory':
                if self.stay_on_fs and (st.st_dev != root_dev or full in self.mounts):
                    self.warn('mount-boundary', full, 'Different filesystem — skipped')
                    self.push_node({
                        'id': self.new_id(), 'parentId': frame['id'], 'name': entry.name, 'rel': rel,
                        'kind': 'other', 'ownBytes': 0, 'knownBytes': 0,
                        'coverage': 'excluded', 'childCount': 0, 'fileCount': 0,
                        'mtimeMs': int(st.st_mtime * 1000), 'issueCount': 1, 'selectable': False,
                        'dev': str(st.st_dev), 'ino': str(st.st_ino)
                    })
                    self.add_child_stats(frame['id'], 0, 0, 1)
                    continue
                if root == '/' and full in SKIP_AT_ROOT:
                    self.warn('excluded', full, 'Pseudo filesystem — skipped')
                    self.push_node({
                        'id': self.new_id(), 'parentId': frame['id'], 'name': entry.name, 'rel': rel,
                        'kind': 'other', 'ownBytes': 0, 'knownBytes': 0,
                        'coverage': 'excluded', 'childCount': 0, 'fileCount': 0,
                        'mtimeMs': int(st.st_mtime * 1000), 'issueCount': 1, 'selectable': False,
                        'dev': str(st.st_dev), 'ino': str(st.st_ino)
                    })
                    self.add_child_stats(frame['id'], 0, 0, 1)
                    continue
                key = (st.st_dev, st.st_ino)
                if key in self.ancestors:
                    self.warn('cycle', full, 'Directory cycle — skipped')
                    self.add_child_stats(frame['id'], 0, 0, 1)
                    continue
                cid = self.new_id()
                self.sums[cid] = [0, 0, 0, issue]
                self.push_node({
                    'id': cid, 'parentId': frame['id'], 'name': entry.name, 'rel': rel,
                    'kind': 'directory', 'ownBytes': 0, 'knownBytes': 0,
                    'coverage': 'pending', 'childCount': 0, 'fileCount': 0,
                    'mtimeMs': int(st.st_mtime * 1000), 'issueCount': issue,
                    'selectable': selectable,
                    'dev': str(st.st_dev), 'ino': str(st.st_ino),
                    'size': 0, 'mtimeNs': str(st.st_mtime_ns)
                })
                self.add_child_stats(frame['id'], 0, 0, 0)
                self.ancestors.add(key)
                stack.append({'path': full, 'id': cid, 'depth': frame['depth'] + 1,
                              'dev': st.st_dev, 'ino': st.st_ino, 'it': None})
            else:
                if kind == 'file':
                    self.scanned_files += 1
                    self.known_bytes += own
                self.push_node({
                    'id': self.new_id(), 'parentId': frame['id'], 'name': entry.name, 'rel': rel,
                    'kind': kind, 'ownBytes': own, 'knownBytes': own,
                    'coverage': 'complete', 'childCount': 0, 'fileCount': 1 if kind == 'file' else 0,
                    'mtimeMs': int(st.st_mtime * 1000), 'issueCount': issue,
                    'selectable': selectable,
                    'dev': str(st.st_dev), 'ino': str(st.st_ino),
                    'size': own, 'mtimeNs': str(st.st_mtime_ns)
                })
                self.add_child_stats(frame['id'], own, 1 if kind == 'file' else 0, issue)

        self.flush_nodes()
        self.progress(self.request['rootPath'], force=True)
        state = 'canceled' if canceled else ('limited' if limited else 'completed')
        term = {
            'type': 'terminal',
            'state': state,
            'scannedFiles': self.scanned_files,
            'scannedDirs': self.scanned_dirs,
            'knownBytes': self.known_bytes,
            'warningCount': self.warning_count
        }
        if limited:
            term['limitReason'] = 'entries'
        self.emit(term)


# ---------- delete ----------

def _identity(st):
    return {'dev': str(st.st_dev), 'ino': str(st.st_ino)}


def _rmtree_fd(dir_fd, root_dev):
    """Recursive delete relative to an open directory fd (O_NOFOLLOW walk)."""
    for name in os.listdir(dir_fd):
        if name in ('.', '..'):
            continue
        try:
            st = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
        except FileNotFoundError:
            continue
        is_link = statmod.S_ISLNK(st.st_mode)
        if statmod.S_ISDIR(st.st_mode) and not is_link:
            if st.st_dev != root_dev:
                raise RuntimeError('MOUNT_BOUNDARY: nested mount inside delete target')
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dir_fd)
            try:
                fst = os.fstat(fd)
                if fst.st_ino != st.st_ino or fst.st_dev != st.st_dev:
                    raise RuntimeError('PATH_CHANGED: directory replaced during delete')
                _rmtree_fd(fd, root_dev)
            finally:
                os.close(fd)
            os.rmdir(name, dir_fd=dir_fd)
        else:
            os.unlink(name, dir_fd=dir_fd)


def _delete(request, should_stop, emit):
    root_real = os.path.realpath(request['rootPath'])
    items = request.get('items', [])
    results = []
    for item in items:
        if should_stop():
            out = {'path': item.get('path'), 'status': 'skipped', 'message': 'Canceled'}
            results.append(out)
            emit({'type': 'delete-item', **out})
            continue
        path = item.get('path') or ''
        expect = item.get('expect') or {}
        out = {'path': path, 'status': 'failed'}
        while True:  # single-pass block for easy break
            norm = os.path.normpath(path)
            # Canonicalize intermediate components (e.g. /var symlink) but
            # NEVER resolve the final component — deleting a symlink must not
            # follow it to its target.
            parent_real = os.path.realpath(os.path.dirname(norm))
            canon = os.path.join(parent_real, os.path.basename(norm))
            rel = os.path.relpath(canon, root_real)
            if rel == '.' or rel == '..' or rel.startswith('..' + os.sep) or os.path.isabs(rel):
                out['message'] = 'OUTSIDE_ROOT'
                break
            try:
                st = os.lstat(norm)
            except FileNotFoundError:
                out['status'] = 'not-found'
                break
            ident = _identity(st)
            if expect.get('dev') != ident['dev'] or expect.get('ino') != ident['ino']:
                out['message'] = 'PATH_CHANGED'
                break
            kind = _kind_of(st.st_mode, statmod.S_ISLNK(st.st_mode))
            if expect.get('kind') != kind:
                out['message'] = 'PATH_CHANGED'
                break
            if kind == 'file':
                if expect.get('size') is not None and expect['size'] != st.st_size:
                    out['message'] = 'PATH_CHANGED'
                    break
                if expect.get('mtimeNs') is not None and str(expect['mtimeNs']) != str(st.st_mtime_ns):
                    out['message'] = 'PATH_CHANGED'
                    break
            try:
                if kind == 'directory':
                    fd = os.open(norm, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        fst = os.fstat(fd)
                        if str(fst.st_dev) != ident['dev'] or str(fst.st_ino) != ident['ino']:
                            raise RuntimeError('PATH_CHANGED')
                        _rmtree_fd(fd, st.st_dev)
                    finally:
                        os.close(fd)
                    os.rmdir(norm)
                else:
                    # file / symlink / other: only ever unlink the entry itself
                    os.unlink(norm)
                out['status'] = 'succeeded'
            except PermissionError as e:
                out['message'] = 'PERMISSION_DENIED: %s' % e
            except RuntimeError as e:
                out['message'] = str(e)
            except OSError as e:
                out['message'] = str(e)
            break
        results.append(out)
        emit({'type': 'delete-item', **out})
    canceled = any(r['status'] == 'skipped' for r in results)
    emit({'type': 'terminal', 'state': 'canceled' if canceled else 'completed', 'results': results})


def run(request, should_stop, emit):
    action = request.get('action')
    if action == 'scan':
        Scanner(request, should_stop, emit).scan()
    elif action == 'delete':
        _delete(request, should_stop, emit)
    else:
        emit({'type': 'terminal', 'state': 'failed', 'errorCode': 'PROTOCOL_ERROR',
              'error': 'Unknown action: %s' % action})
