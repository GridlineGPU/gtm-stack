// Tests always run on the made-up companies in tests/fixtures, never on a workspace's real source data.
process.env.OUTREACH_SOURCE_DIR = new URL("./fixtures", import.meta.url).pathname;
