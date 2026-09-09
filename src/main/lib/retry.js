const elog = require('electron-log');

async function withJwtRetry(queryFn, { maxRetries = 1, delayMs = 2000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await queryFn();
    if (!result.error) return result;
    if (result.error.code === 'PGRST303' && attempt < maxRetries) {
      elog.info(`[retry] JWT clock skew, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    return result;
  }
}

module.exports = { withJwtRetry };
