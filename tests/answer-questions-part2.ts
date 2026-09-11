import { runQuiz } from './helpers/quiz-runner';

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.name, err?.message);
  console.error(err?.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

const userKey = process.argv[2] ?? 'user1';
runQuiz('Phần 2. Hệ thống báo hiệu đường bộ', 'part2', userKey).catch(err => {
  console.error('[CRASH]', err?.name, err?.message);
  console.error(err?.stack);
  process.exit(1);
});
