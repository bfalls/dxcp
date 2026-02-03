import { runAllTests } from './src/__tests__/App.test.jsx'

try {
  await runAllTests()
  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode)
  }
} catch (err) {
  console.error(err)
  process.exit(1)
}
