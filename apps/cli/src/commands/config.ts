/**
 * `agentlens config` (spec §16, §9) — inspect and edit the versioned config.
 *
 * Subcommands: `path` (print config.json location), `validate` (validate +
 * report errors), `get <key>` (print a dotted-path value), `set <key> <value>`
 * (write + validate + persist).
 */
import { Command } from "commander";
import pc from "picocolors";
import {
  configPath,
  loadConfig,
  saveConfig,
  getConfigValue,
  setConfigValue,
  validate,
  type AgentLensConfig,
} from "@agentlens/config";
import { resolveHome } from "../context.js";

export function makeConfigCommand(): Command {
  const cmd = new Command("config").description("Inspect and edit the AgentLens configuration.");

  cmd
    .command("path")
    .description("Print the path to config.json.")
    .action(() => {
      process.stdout.write(`${configPath(resolveHome())}\n`);
    });

  cmd
    .command("validate")
    .description("Validate the on-disk config and report any errors.")
    .action(async () => {
      const home = resolveHome();
      const config = await loadConfig(home);
      const result = validate(config);
      if (result.ok) {
        process.stdout.write(pc.green("config.json is valid.\n"));
      } else {
        process.stdout.write(pc.red("config.json is invalid:\n"));
        for (const e of result.errors) process.stdout.write(`  - ${e}\n`);
        process.exitCode = 2;
      }
    });

  cmd
    .command("get")
    .description("Print the value at a dotted config path (e.g. privacy.mode).")
    .argument("<key>", "Dotted config path.")
    .action(async (key: string) => {
      const config = await loadConfig(resolveHome());
      const value = getConfigValue(config, key);
      if (value === undefined) {
        process.stdout.write(pc.dim(`(unset) ${key}\n`));
      } else {
        process.stdout.write(
          `${typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}\n`,
        );
      }
    });

  cmd
    .command("set")
    .description("Set a dotted config path to a value and persist it.")
    .argument("<key>", "Dotted config path.")
    .argument("[value]", "Value (strings like true/false/numbers are coerced).")
    .action(async (key: string, value: string | undefined) => {
      if (value === undefined) {
        throw new Error(`config set requires a value for "${key}"`);
      }
      const home = resolveHome();
      const config = await loadConfig(home);
      const next: AgentLensConfig = setConfigValue(config, key, value);
      await saveConfig(home, next);
      process.stdout.write(pc.green(`set ${key} = ${value}\n`));
    });

  return cmd;
}
