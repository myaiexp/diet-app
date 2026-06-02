// Assert a required environment variable is set, exiting with a clear error if not
export function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} not set`);
    process.exit(1);
  }
  return value;
}
