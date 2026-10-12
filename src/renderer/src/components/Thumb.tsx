import { Skeleton } from 'antd'
import { VideoCameraOutlined } from '@ant-design/icons'
import type { ThumbState } from '../store/files-store'

interface Props {
  state: ThumbState
  /** 容器尺寸;图片按比例完整显示(contain),不会被裁切或拉伸 */
  width: number | string
  height: number | string
}

/** 缩略图:加载中显示骨架屏,没有缩略图时显示占位,有就显示图片 */
export function Thumb({ state, width, height }: Props): React.JSX.Element {
  const box = { width, height }

  if (state.status === 'loading') {
    return (
      <div className="thumb" style={box} data-testid="thumb-loading">
        <Skeleton.Image active style={{ width: '100%', height: '100%' }} />
      </div>
    )
  }
  if (state.status === 'none') {
    return (
      <div className="thumb thumb-empty" style={box} data-testid="thumb-none">
        <VideoCameraOutlined />
      </div>
    )
  }
  return (
    <div className="thumb" style={box}>
      <img
        data-testid="file-thumb"
        data-kind={state.thumbnail.kind}
        src={state.thumbnail.dataUrl}
        alt=""
        draggable={false}
      />
    </div>
  )
}
