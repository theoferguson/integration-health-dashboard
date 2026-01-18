import { createApp } from './app.js';

const app = createApp();
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Integration Health Dashboard API running on port ${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`   Frontend: http://localhost:5173 (run 'npm run dev:web' separately)`);
  }
});
