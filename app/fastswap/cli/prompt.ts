import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline";

export type Prompt = {
  ask(question: string, defaultValue?: string): Promise<string>;
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
  choose<T extends string>(question: string, options: readonly T[], defaultValue?: T): Promise<T>;
  close(): void;
};

export function createPrompt(): Prompt {
  const rl = createInterface({ input, output });

  return {
    async ask(question, defaultValue) {
      const suffix = defaultValue !== undefined && defaultValue !== "" ? ` [${defaultValue}]` : "";
      const answer = (await rl.question(`${question}${suffix}: `)).trim();
      if (!answer && defaultValue !== undefined) return defaultValue;
      return answer;
    },
    async confirm(question, defaultValue = false) {
      if (isInteractive()) {
        rl.pause();
        try {
          return await confirmWithArrows(question, defaultValue);
        } finally {
          rl.resume();
        }
      }
      const hint = defaultValue ? "Y/n" : "y/N";
      const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
      if (!answer) return defaultValue;
      return answer === "y" || answer === "yes";
    },
    async choose(question, options, defaultValue) {
      if (options.length === 0) throw new Error("choose() requires at least one option");
      if (options.length === 1) return options[0]!;

      if (isInteractive()) {
        rl.pause();
        try {
          return await selectWithArrows(question, options, defaultValue);
        } finally {
          rl.resume();
        }
      }

      return chooseWithNumbers(rl, question, options, defaultValue);
    },
    close() {
      rl.close();
    },
  };
}

function isInteractive(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

async function selectWithArrows<T extends string>(
  question: string,
  options: readonly T[],
  defaultValue?: T
): Promise<T> {
  const defaultIndex = defaultValue ? options.indexOf(defaultValue) : 0;
  let index = defaultIndex >= 0 ? defaultIndex : 0;
  const hint = "↑/↓ select · Enter confirm";

  readline.emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);

  const render = (first = false) => {
    const lines = options.length + 2;
    if (!first) {
      readline.moveCursor(output, 0, -lines);
      readline.clearScreenDown(output);
    }
    output.write(`${question}\n`);
    output.write(`\x1b[2m${hint}\x1b[0m\n`);
    for (let i = 0; i < options.length; i++) {
      if (i === index) output.write(`\x1b[36m❯ ${options[i]}\x1b[0m\n`);
      else output.write(`  ${options[i]}\n`);
    }
  };

  return new Promise((resolve, reject) => {
    render(true);
    output.write("\x1B[?25l");

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY) input.setRawMode(false);
      output.write("\x1B[?25h");
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Cancelled"));
        return;
      }
      if (key.name === "return") {
        cleanup();
        output.write("\n");
        resolve(options[index]!);
        return;
      }
      if (key.name === "up") {
        index = (index - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === "down") {
        index = (index + 1) % options.length;
        render();
      }
    };

    input.on("keypress", onKeypress);
  });
}

async function confirmWithArrows(question: string, defaultValue = false): Promise<boolean> {
  const options = ["Yes", "No"] as const;
  let index = defaultValue ? 0 : 1;
  const hint = "←/→ or ↑/↓ select · Enter confirm";

  readline.emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);

  const render = (first = false) => {
    const lines = 3;
    if (!first) {
      readline.moveCursor(output, 0, -lines);
      readline.clearScreenDown(output);
    }
    output.write(`${question}\n`);
    output.write(`\x1b[2m${hint}\x1b[0m\n`);
    const labels = options.map((label, i) => (i === index ? `\x1b[36m❯ ${label}\x1b[0m` : `  ${label}`));
    output.write(`${labels.join("    ")}\n`);
  };

  return new Promise((resolve, reject) => {
    render(true);
    output.write("\x1B[?25l");

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY) input.setRawMode(false);
      output.write("\x1B[?25h");
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Cancelled"));
        return;
      }
      if (key.name === "return") {
        cleanup();
        output.write("\n");
        resolve(index === 0);
        return;
      }
      if (key.name === "left" || key.name === "up") {
        index = 0;
        render();
        return;
      }
      if (key.name === "right" || key.name === "down") {
        index = 1;
        render();
      }
    };

    input.on("keypress", onKeypress);
  });
}

async function chooseWithNumbers<T extends string>(
  rl: ReturnType<typeof createInterface>,
  question: string,
  options: readonly T[],
  defaultValue?: T
): Promise<T> {
  console.log(question);
  options.forEach((option, index) => {
    const marker = option === defaultValue ? "*" : " ";
    console.log(`  ${marker} ${index + 1}. ${option}`);
  });
  while (true) {
    const answer = (await rl.question("Select number: ")).trim();
    if (!answer && defaultValue) return defaultValue;
    const index = Number(answer) - 1;
    if (index >= 0 && index < options.length) return options[index]!;
    console.log("Invalid selection.");
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
