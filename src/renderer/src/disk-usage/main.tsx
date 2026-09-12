import React from 'react'
import { createRoot } from 'react-dom/client'
import DiskUsageApp from './DiskUsageApp'
import '../index.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DiskUsageApp />
  </React.StrictMode>
)
