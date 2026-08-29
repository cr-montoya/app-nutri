import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lockPath = join(tmpdir(), "appnutri-preview-seed-tests.lock");

export async function acquirePreviewSeedTestLock(): Promise<() => Promise<void>> {
  const deadline = Date.now() + 60_000;

  while (true) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- lockPath is a fixed module constant
      const handle = await open(lockPath, "wx");
      return async () => {
        await handle.close();
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- lockPath is a fixed module constant
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
