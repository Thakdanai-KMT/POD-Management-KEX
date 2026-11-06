import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// ลงทะเบียน Service Worker เฉพาะ Production เพื่อรองรับการใช้งานออฟไลน์
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('ลงทะเบียน Service Worker ไม่สำเร็จ:', error)
    })
  })
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)