import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { borderRadius: 8 } }}>
      <AntApp style={{ height: '100%' }}>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>
)
