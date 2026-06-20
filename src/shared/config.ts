import 'dotenv/config';

const ENV_VARS = [
  "ACCESS_TOKEN",
  "APP_SECRET",
  "VERIFY_TOKEN",
  "REDIS_HOST",
  "REDIS_PORT",
  "GEMINI_API_KEY",
] as const;

interface Config {
  appSecret: string | undefined;
  accessToken: string | undefined;
  verifyToken: string | undefined;
  port: number;
  redisHost: string;
  redisPort: number;
  geminiApiKey: string;
  checkEnvVariables: () => void;
}

export const config: Config = Object.freeze({
  appSecret:   process.env.APP_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,

  port:      Number(process.env.PORT) || 8080,
  redisHost: process.env.REDIS_HOST   || "localhost",
  redisPort: Number(process.env.REDIS_PORT) || 6379,

  geminiApiKey: process.env.GEMINI_API_KEY || "",

  checkEnvVariables() {
    for (const key of ENV_VARS) {
      if (!process.env[key]) {
        console.warn(`WARNING: Missing the environment variable ${key}`);
      }
    }
  },
});
