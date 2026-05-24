import openPkg from "open";

export async function openInBrowser(url: string): Promise<void> {
  try {
    await openPkg(url);
  } catch (e) {
    process.stderr.write(
      `[copilot-deck] could not auto-open browser: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}
