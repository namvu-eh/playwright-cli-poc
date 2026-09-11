import { runQuiz } from './helpers/quiz-runner';

const userKey = process.argv[2] ?? 'user1';
runQuiz('Phần 2. Hệ thống báo hiệu đường bộ', 'part2', userKey).catch(console.error);
