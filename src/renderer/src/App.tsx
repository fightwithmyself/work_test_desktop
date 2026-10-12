import { useCallback, useState } from 'react'
import { App as AntApp, Button, Popconfirm, Space, Typography } from 'antd'
import { DeleteOutlined, InboxOutlined, PlusOutlined } from '@ant-design/icons'
import { DetailPanel } from './components/DetailPanel'
import { EmptyState } from './components/EmptyState'
import { FileRow } from './components/FileRow'
import { useFileDrop } from './hooks/use-file-drop'
import { useFilesStore } from './store'

export default function App(): React.JSX.Element {
  const { message } = AntApp.useApp()
  const entries = useFilesStore((s) => s.entries)
  const selectedId = useFilesStore((s) => s.selectedId)
  const addPaths = useFilesStore((s) => s.addPaths)
  const select = useFilesStore((s) => s.select)
  const remove = useFilesStore((s) => s.remove)
  const clear = useFilesStore((s) => s.clear)
  const [picking, setPicking] = useState(false)

  const handlePaths = useCallback(
    (paths: string[]) => {
      const { added, duplicates } = addPaths(paths)
      if (duplicates > 0) {
        message.info(
          added > 0
            ? `已添加 ${added} 个文件,跳过 ${duplicates} 个已在列表中的文件`
            : '这些文件已经在列表里了'
        )
      }
    },
    [addPaths, message]
  )

  const handleNoPath = useCallback(() => {
    message.warning('没有读到文件的位置(可能不是从资源管理器拖来的),请改用“添加视频”按钮选择。')
  }, [message])

  const dragging = useFileDrop({ onPaths: handlePaths, onNoPath: handleNoPath })

  const pick = async (): Promise<void> => {
    setPicking(true)
    try {
      const paths = await window.api.files.pick()
      if (paths.length > 0) handlePaths(paths)
    } finally {
      setPicking(false)
    }
  }

  const selected = entries.find((entry) => entry.id === selectedId) ?? null

  return (
    <div className="app">
      <header className="app-header">
        <Typography.Title level={4} style={{ margin: 0 }}>
          VideoConverter
        </Typography.Title>
        <Space>
          {entries.length > 0 && (
            <Popconfirm
              title="清空列表?"
              description="只会清空这里的列表,不会删除任何文件。"
              okText="清空"
              cancelText="取消"
              onConfirm={clear}
            >
              <Button icon={<DeleteOutlined />} data-testid="clear-button">
                清空
              </Button>
            </Popconfirm>
          )}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={picking}
            onClick={pick}
            data-testid="add-button"
          >
            添加视频
          </Button>
        </Space>
      </header>

      <main className="app-main">
        <section className="list-pane" aria-label="视频列表">
          {entries.length === 0 ? (
            <EmptyState onPick={pick} picking={picking} />
          ) : (
            <ul className="file-list" data-testid="file-list">
              {entries.map((entry) => (
                <FileRow
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === selectedId}
                  onSelect={() => select(entry.id === selectedId ? null : entry.id)}
                  onRemove={() => remove(entry.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {selected && <DetailPanel entry={selected} onClose={() => select(null)} />}
      </main>

      {dragging && (
        <div className="drop-overlay" data-testid="drop-overlay">
          <InboxOutlined />
          <span>松开鼠标,添加这些视频</span>
        </div>
      )}
    </div>
  )
}
