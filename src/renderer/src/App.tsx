import { useEffect, useState } from 'react'
import { Descriptions, Flex, Typography } from 'antd'
import type { AppInfo } from '../../shared/ipc-channels'

const { Title, Text } = Typography

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  // 脚手架阶段的"链路自检":渲染层 → preload → 主进程 → 返回
  useEffect(() => {
    void window.api.app.getInfo().then(setInfo)
  }, [])

  return (
    <Flex vertical align="center" justify="center" gap={24} style={{ height: '100vh' }}>
      <Title level={1} style={{ margin: 0 }}>
        VideoConverter
      </Title>
      <Text type="secondary">视频格式转换器 · 桌面客户端</Text>
      {info && (
        <Descriptions size="small" column={1} bordered data-testid="app-info">
          <Descriptions.Item label="Electron">{info.electron}</Descriptions.Item>
          <Descriptions.Item label="Chrome">{info.chrome}</Descriptions.Item>
          <Descriptions.Item label="Node">{info.node}</Descriptions.Item>
        </Descriptions>
      )}
    </Flex>
  )
}
