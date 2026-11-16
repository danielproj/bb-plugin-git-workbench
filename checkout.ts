import {
  lstat,
  stat,
  realpath,
  mkdir,
  mkdtemp,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import path from "node:path";
import { git } from "./git";
import type { CheckoutInspection } from "./repositories";
export async function inspectCheckout(
  directory: string,
  signal?: AbortSignal,
): Promise<CheckoutInspection> {
  try {
    if (!(await stat(directory)).isDirectory()) return { state: "not_git" };
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(
        (error as NodeJS.ErrnoException).code || "",
      )
    )
      return { state: "missing" };
    throw error;
  }
  const output = await git(
    directory,
    ["rev-parse", "--show-toplevel"],
    signal,
    undefined,
    true,
  );
  if (output.includes("not a git repository")) return { state: "not_git" };
  if (output.startsWith("fatal:")) throw Error(output.trim());
  if ((await realpath(output.trim())) !== (await realpath(directory)))
    return { state: "not_git" };
  return { state: "ready" };
}
export async function restoreCheckout(
  directory: string,
  remoteUrl: string,
  signal?: AbortSignal,
) {
  if (!path.isAbsolute(directory))
    throw Error("Checkout path must be absolute.");
  if (
    !/^(https?:\/\/|ssh:\/\/|git@)/.test(remoteUrl) &&
    !path.isAbsolute(remoteUrl)
  )
    throw Error("Use an HTTPS, SSH, or local Git remote.");
  try {
    await lstat(directory);
    if ((await inspectCheckout(directory, signal)).state === "ready") return;
    throw Error(
      "The checkout path already exists. Its contents have been preserved.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = path.dirname(directory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, ".gw-checkout-"));
  let reserved = false;
  try {
    await git(
      parent,
      ["clone", "--quiet", "--", remoteUrl, path.join(staging, "repository")],
      signal,
      undefined,
      false,
      300000,
    );
    signal?.throwIfAborted();
    // Reserve the destination exclusively. A concurrent process creating it makes this fail.
    await mkdir(directory);
    reserved = true;
    await rename(path.join(staging, "repository"), directory);
    reserved = false;
  } finally {
    // rmdir cannot remove a directory into which another process has written files.
    if (reserved) await rmdir(directory).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}
