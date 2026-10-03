import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * The wiki is a bundle in Open Knowledge Format 0.2 (see wiki/index.md).
 * These checks are the conformance rules of the spec (§11) plus the two this
 * bundle adds: links between concepts resolve, and every concept is listed
 * in the index of its directory.
 */
const ROOT = join(__dirname, "..", "wiki");
const RESERVED = new Set(["index.md", "log.md"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name.endsWith(".md") ? [path] : [];
  });
}

function split(path: string): { frontmatter: Record<string, unknown> | null; body: string } {
  const text = readFileSync(path, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  return match ? { frontmatter: parse(match[1]) as Record<string, unknown>, body: match[2] } : { frontmatter: null, body: text };
}

/** Targets of the markdown links of a body, without anchors; external ones left out. */
function localLinks(body: string): string[] {
  return Array.from(body.matchAll(/\]\(([^)\s]+)\)/g), (m) => m[1].split("#")[0]).filter(
    (target) => target && !/^[a-z]+:/i.test(target),
  );
}

const files = walk(ROOT);
const concepts = files.filter((f) => !RESERVED.has(f.split("/").pop()!));
const name = (path: string) => relative(ROOT, path);

describe("wiki (OKF 0.2 bundle)", () => {
  it("has concepts", () => {
    expect(concepts.length).toBeGreaterThan(20);
  });

  it.each(concepts.map((c) => [name(c), c]))("%s has a frontmatter with a type, title and description", (_, path) => {
    const { frontmatter } = split(path);
    expect(frontmatter).not.toBeNull();
    for (const key of ["type", "title", "description"]) {
      expect(typeof frontmatter![key], key).toBe("string");
      expect((frontmatter![key] as string).trim(), key).not.toBe("");
    }
  });

  it.each(concepts.map((c) => [name(c), c]))("%s: sources have a resource, local ones exist, footnotes match an id", (_, path) => {
    const { frontmatter, body } = split(path);
    const sources = (frontmatter!.sources ?? []) as { id?: string; resource?: string }[];
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(typeof source.resource).toBe("string");
      if (!/^[a-z]+:/i.test(source.resource!)) expect(existsSync(resolve(dirname(path), source.resource!)), source.resource).toBe(true);
    }
    const ids = new Set(sources.map((s) => s.id));
    for (const [, label] of body.matchAll(/\[\^([^\]]+)\]/g)) expect(ids.has(label), `footnote ${label}`).toBe(true);
  });

  it.each(concepts.map((c) => [name(c), c]))("%s: timestamps are ISO 8601 with an offset", (_, path) => {
    const { frontmatter } = split(path);
    const stamps = [
      frontmatter!.stale_after,
      ...((frontmatter!.sources ?? []) as { last_modified?: unknown }[]).map((s) => s.last_modified),
    ].filter((v) => v !== undefined);
    // The YAML parser keeps them as strings: a bare date would not match.
    for (const stamp of stamps) expect(String(stamp)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
  });

  it.each(files.map((f) => [name(f), f]))("%s: links to other files resolve", (_, path) => {
    for (const target of localLinks(split(path).body)) {
      expect(existsSync(resolve(dirname(path), target)), target).toBe(true);
    }
  });

  it("index files have no frontmatter, except okf_version in the root one", () => {
    for (const path of files.filter((f) => f.endsWith("/index.md"))) {
      const { frontmatter } = split(path);
      if (name(path) === "index.md") expect(frontmatter).toEqual({ okf_version: "0.2" });
      else expect(frontmatter, name(path)).toBeNull();
    }
  });

  it("every concept is listed in the index of its directory, with its description", () => {
    for (const path of concepts) {
      const index = readFileSync(join(dirname(path), "index.md"), "utf8");
      const { frontmatter } = split(path);
      const file = path.split("/").pop()!;
      expect(index, name(path)).toContain(`](${file}) - ${frontmatter!.description}`);
    }
  });

  it("the log has ISO dates, newest first", () => {
    const dates = Array.from(readFileSync(join(ROOT, "log.md"), "utf8").matchAll(/^## (.+)$/gm), (m) => m[1]);
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
