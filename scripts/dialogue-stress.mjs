import fs from 'node:fs'
import { loadTs } from '../tests/load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts')
const scenarios = JSON.parse(fs.readFileSync(new URL('../evals/multi-turn-dialogue-cases.json', import.meta.url), 'utf8'))
const failures = []
let turns = 0
let completedEvidenceChecks = 0
let duplicateChecks = 0

const latestQuestion = (session) => [...session.trace].reverse().find((item) => item.move)

for (const scenario of scenarios) {
  let session = engine.createSession(scenario.question)
  if (session.cognitiveType !== scenario.expectedType) {
    failures.push(`${scenario.id}: expected type ${scenario.expectedType}, got ${session.cognitiveType}`)
  }

  for (const [index, turn] of scenario.turns.entries()) {
    turns += 1
    const before = latestQuestion(session)
    if (before?.move !== turn.answeringMove) {
      failures.push(`${scenario.id} turn ${index + 1}: expected answering ${turn.answeringMove}, got ${before?.move}`)
    }
    const oldQuestions = session.trace.filter((item) => item.move).map((item) => item.content)
    session = engine.appendUserResponse(session, turn.answer)
    const analysis = session.analyses.at(-1)
    const completed = new Set((analysis.completedMoveEvidence || []).map((item) => item.move))
    completedEvidenceChecks += 1
    if (analysis.engagement !== 'engaged') failures.push(`${scenario.id} turn ${index + 1}: unexpectedly ${analysis.engagement}`)
    if (!completed.has(turn.answeringMove)) failures.push(`${scenario.id} turn ${index + 1}: did not complete ${turn.answeringMove}`)
    for (const evidence of analysis.completedMoveEvidence || []) {
      if (evidence.excerpt !== turn.answer) failures.push(`${scenario.id} turn ${index + 1}: completion evidence is not current user text`)
    }
    const next = latestQuestion(session)
    if (next?.move !== turn.nextMove) failures.push(`${scenario.id} turn ${index + 1}: expected next ${turn.nextMove}, got ${next?.move}`)
    for (const old of oldQuestions.slice(-5)) {
      duplicateChecks += 1
      if (engine.textSimilarity(next.content, old) >= 0.9) failures.push(`${scenario.id} turn ${index + 1}: near-duplicate follow-up`)
    }
  }
}

const result = {
  suite: 'V0.5.3 multi-turn dialogue stress',
  scenarios: scenarios.length,
  turns,
  completedEvidenceChecks,
  duplicateChecks,
  failures: failures.length,
  status: failures.length ? 'failed' : 'passed',
}
console.log(JSON.stringify(result, null, 2))
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}
