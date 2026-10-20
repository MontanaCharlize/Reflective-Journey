import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CommunityStore } from '../server/community-store.mjs'
import { loadProjectEnv } from '../server/env.mjs'
import { CommunityFeatures } from '../server/community-features.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [command, id, ...words] = process.argv.slice(2)
if (!['reports', 'withdraw', 'review'].includes(command) || (command === 'withdraw' && (!id || words.join(' ').trim().length < 4)) || (command === 'review' && (!id || !['keep', 'withdraw'].includes(words[0]) || words.slice(1).join(' ').trim().length < 4))) {
  console.error('用法：npm run moderate -- reports [pending|resolved|all] [游标]\n      npm run moderate -- review <反馈ID> keep|withdraw "处理说明（至少4字）"\n      npm run moderate -- withdraw <卡片ID> "处理原因（至少4字）"')
  process.exitCode = 1
} else {
  const env = loadProjectEnv(root)
  const store = new CommunityStore(path.resolve(root, env.COMMUNITY_DB_PATH || 'data/community.sqlite'))
  const community = new CommunityFeatures(store)
  try {
    if (command === 'reports') console.log(JSON.stringify(community.reports({ status: id || 'pending', cursor: words[0] || '' }), null, 2))
    else if (command === 'review') {
      const report = store.db.prepare('SELECT r.created_at,COALESCE(m.revision,1) card_revision FROM reports r LEFT JOIN card_meta m ON m.card_id=r.card_id WHERE r.id=?').get(id)
      if (!report) throw new Error('找不到这条反馈。')
      community.resolveReport(id, null, { resolution: words[0], note: words.slice(1).join(' '), expectedAt: report.created_at, expectedRevision: report.card_revision })
      console.log('处理结果已保存，提交反馈的人可以在“我的反馈”查看。')
    }
    else { store.moderateWithdraw(id, words.join(' ')); console.log('已停止公开，保留作者副本和运营处理记录。') }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
  finally { store.close() }
}
