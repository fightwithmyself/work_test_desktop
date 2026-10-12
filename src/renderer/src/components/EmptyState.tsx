import { Button, Typography } from 'antd'
import { InboxOutlined } from '@ant-design/icons'

interface Props {
  onPick: () => void
  picking: boolean
}

/** 空状态:告诉用户"能做什么、怎么做",而不是一片空白 */
export function EmptyState({ onPick, picking }: Props): React.JSX.Element {
  return (
    <div className="empty-state" data-testid="empty-state">
      <InboxOutlined className="empty-icon" />
      <Typography.Title level={3} style={{ margin: 0 }}>
        把视频拖到这里
      </Typography.Title>
      <Typography.Text type="secondary">
        可以一次拖入多个文件;也可以点下面的按钮选择
      </Typography.Text>
      <Button
        type="primary"
        size="large"
        loading={picking}
        onClick={onPick}
        data-testid="pick-button"
      >
        选择视频文件
      </Button>
      <Typography.Text type="secondary" className="empty-hint">
        支持 MP4、MKV、AVI、MOV、WebM、FLV、TS 等常见格式
      </Typography.Text>
    </div>
  )
}
