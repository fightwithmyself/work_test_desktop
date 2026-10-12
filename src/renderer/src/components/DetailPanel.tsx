import { Alert, Button, Descriptions, Skeleton, Typography } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { buildInfoSections } from '@core/info-sections'
import type { FileEntry } from '../store/files-store'
import { Thumb } from './Thumb'

interface Props {
  entry: FileEntry
  onClose: () => void
}

/** 右侧信息面板:展示一个文件的完整信息;失败时展示原因和(折叠的)技术细节 */
export function DetailPanel({ entry, onClose }: Props): React.JSX.Element {
  const { probe } = entry

  return (
    <aside className="detail-panel" data-testid="detail-panel">
      <div className="detail-head">
        <Typography.Title level={5} style={{ margin: 0 }}>
          文件信息
        </Typography.Title>
        <Button
          type="text"
          icon={<CloseOutlined />}
          aria-label="关闭信息面板"
          data-testid="detail-close"
          onClick={onClose}
        />
      </div>

      <div className="detail-scroll">
        <Thumb state={entry.thumb} width="100%" height={190} />
        <Typography.Paragraph strong className="detail-name" data-testid="detail-name">
          {entry.name}
        </Typography.Paragraph>

        {probe.status === 'loading' && <Skeleton active paragraph={{ rows: 8 }} />}

        {probe.status === 'error' && (
          <>
            <Alert
              type="error"
              showIcon
              title={probe.error.message}
              description={entry.path}
              data-testid="detail-error"
            />
            {probe.error.detail && (
              <details className="tech-detail">
                <summary>技术细节</summary>
                <pre>{probe.error.detail}</pre>
              </details>
            )}
          </>
        )}

        {probe.status === 'ready' &&
          buildInfoSections(probe.info, { name: entry.name, path: entry.path }).map((section) => (
            <Descriptions
              key={section.id}
              size="small"
              bordered
              column={1}
              title={section.title}
              className="detail-section"
              data-testid={`section-${section.id}`}
              items={section.rows.map((row) => ({
                key: row.label,
                label: row.label,
                children: row.value
              }))}
            />
          ))}
      </div>
    </aside>
  )
}
