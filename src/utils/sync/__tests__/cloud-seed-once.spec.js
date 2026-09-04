import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/native/fs', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => true),
  readDir: vi.fn(async () => []),
}))
vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...parts) => parts.join('/') },
  addCloseHandler: vi.fn(),
}))
vi.mock('@/utils/sync/sync-repository', () => ({
  getSyncDeviceId: () => 'dev-test',
  getCommitsDir: vi.fn(async () => '/tmp/commits'),
}))
vi.mock('@/utils/sync/transports/seed', () => ({
  writeInitialSnapshots: vi.fn(async () => {}),
}))

import { readDir, writeFile } from '@/lib/native/fs'
import { getCommitsDir } from '@/utils/sync/sync-repository'
import { writeInitialSnapshots } from '@/utils/sync/transports/seed'
import { CloudTransport } from '@/utils/sync/transports/cloud'

function makeTransport() {
  const t = new CloudTransport()
  t.setReadiness({ syncAllowed: true, workspaceId: 'ws-1' })
  return t
}

describe('CloudTransport.seedOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCommitsDir.mockResolvedValue('/tmp/commits')
    readDir.mockResolvedValue([])
  })

  it('is a no-op when no sync folder is configured', async () => {
    getCommitsDir.mockResolvedValue(null)
    await makeTransport().seedOnce()
    expect(readDir).not.toHaveBeenCalled()
    expect(writeInitialSnapshots).not.toHaveBeenCalled()
  })

  it('skips when the seeded marker already exists', async () => {
    readDir.mockResolvedValue(['._seeded'])
    await makeTransport().seedOnce()
    expect(writeFile).not.toHaveBeenCalled()
    expect(writeInitialSnapshots).not.toHaveBeenCalled()
  })

  it('seeds initial snapshots into an empty commits dir', async () => {
    await makeTransport().seedOnce()
    expect(writeFile).toHaveBeenCalledWith('/tmp/commits/._seeded', '')
    expect(writeInitialSnapshots).toHaveBeenCalledWith('/tmp/commits')
  })

  it('writes the marker but skips snapshots when yjs updates already exist', async () => {
    readDir.mockResolvedValue(['note-1~~dev~~123~~1.yjs.json'])
    await makeTransport().seedOnce()
    expect(writeFile).toHaveBeenCalledWith('/tmp/commits/._seeded', '')
    expect(writeInitialSnapshots).not.toHaveBeenCalled()
  })
})
