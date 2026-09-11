import { runQuiz } from './helpers/quiz-runner';

const userKey = process.argv[2] ?? 'user1';
runQuiz('Phần 1. Luật Trật tự, an toàn giao thông đường bộ', 'part1', userKey).catch(console.error);
