#!/usr/bin/env node
// Bumps the app version in the three places that carry it, commits, and
// tags. Pushing the tag is left to a person: that is what publishes.
//
//   npm run release -- 0.2.0
//   git push origin main --tags

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: npm run release -- <major.minor.patch>");
  process.exit(1);
}
const branch = execSync("git branch --show-current").toString().trim();
if (execSync("git status --porcelain").toString().trim()) {
  console.error("the working tree is not clean; commit or stash first");
  process.exit(1);
}

const edit = (path, fn) => writeFileSync(path, fn(readFileSync(path, "utf8")));
edit("package.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`));
execSync("cargo update -p lita --offline", { stdio: "ignore" }); // refresh Cargo.lock without touching the network

execSync(`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock`);
execSync(`git commit -q -m "chore(release): v${version}"`);
execSync(`git tag -a v${version} -m "Lita v${version}"`);
console.log(`v${version} tagged on ${branch}. Publish with: git push origin ${branch} --tags`);
