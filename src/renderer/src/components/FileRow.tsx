import { Button, Skeleton, Tag, Tooltip, Typography } from 'antd'
import { CloseOutlined, ExclamationCircleFilled } from '@ant-design/icons'
import {
  formatCodecName,
  formatDuration,
  formatFileSize,
  formatResolution
} from '@core/format-utils'
import type { VideoInfo } from '@shared/types'
import type { FileEntry } from '../store/files-store'
import { Thumb } from './Thumb'

interface Props {
  entry: FileEntry
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}

function resolutionLabel(info: VideoInfo): string {
  const video = info.videoStreams[0]
  // 用"显示分辨率"(已考虑旋转),这才是用户实际看到的画面大小
  return video ? formatResolution(video.displayWidth, video.displayHeight) : '仅音频'
}

function Facts({ info }: { info: VideoInfo }): React.JSX.Element {
  const codec = info.videoStreams[0]?.codec ?? info.audioStreams[0]?.codec ?? null
  return (
    <div className="facts">
      <Tag data-testid="file-duration">{formatDuration(info.durationSec)}</Tag>
      <Tag data-testid="file-resolution">{resolutionLabel(info)}</Tag>
      <Tag data-testid="file-size">{formatFileSize(info.sizeBytes)}</Tag>
      {codec && <Tag bordered={false}>{formatCodecName(codec)}</Tag>}
    </div>
  )
}

export function FileRow({ entry, selected, onSelect, onRemove }: Props): React.JSX.Element {
  const { probe } = entry
  return (
    <li
      className={`file-row${selected ? ' selected' : ''}${probe.status === 'error' ? ' failed' : ''}`}
      data-testid="file-row"
      data-status={probe.status}
      aria-current={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <Thumb state={entry.thumb} width={160} height={90} />

      <div className="row-body">
        <Typography.Text strong ellipsis={{ tooltip: entry.path }} data-testid="file-name">
          {entry.name}
        </Typography.Text>

        {probe.status === 'loading' && (
          <Skeleton
            active
            title={false}
            paragraph={{ rows: 1, width: 240 }}
            data-testid="info-loading"
          />
        )}
        {probe.status === 'ready' && <Facts info={probe.info} />}
        {probe.status === 'error' && (
          <Typography.Text type="danger" className="row-error" data-testid="file-error">
            <ExclamationCircleFilled /> {probe.error.message}
          </Typography.Text>
        )}
      </div>

      <Tooltip title="从列表移除">
        <Button
          type="text"
          icon={<CloseOutlined />}
          aria-label={`移除 ${entry.name}`}
          data-testid="remove-button"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        />
      </Tooltip>
    </li>
  )
}
