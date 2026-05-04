import { BigNumberish, Contract, Provider, getAddress } from "ethers";
import { ERC20_ABI, NATIVE_TOKEN } from "./abis.js";

export interface PaymentRequirement {
  token?: string;
  minBalance: BigNumberish;
}

export interface PaymentBalance {
  token: string;
  balance: bigint;
  minBalance: bigint;
}

export interface PaymentHit {
  address: string;
  balances: PaymentBalance[];
}

export type PaymentCallback = (hits: PaymentHit[]) => void | Promise<void>;

export interface MonitorPaymentOptions {
  intervalMs?: number;
  autoStart?: boolean;
}

export interface MonitorPaymentController {
  addAddress(address: string, requirements: PaymentRequirement[]): void;
  removeAddress(address: string): void;
  checkNow(): Promise<PaymentHit[]>;
  start(): void;
  stop(): void;
}

interface TrackedAddress {
  address: string;
  requirements: NormalizedRequirement[];
}

interface NormalizedRequirement {
  token: string;
  minBalance: bigint;
}

export function monitorPayment(
  provider: Provider,
  address: string,
  requirements: PaymentRequirement[],
  callback: PaymentCallback,
  options: MonitorPaymentOptions = {}
): MonitorPaymentController {
  const intervalMs = options.intervalMs ?? 12_000;
  const tracked = new Map<string, TrackedAddress>();
  let timer: NodeJS.Timeout | undefined;
  let checking = false;

  const controller: MonitorPaymentController = {
    addAddress(nextAddress, nextRequirements) {
      const normalizedAddress = getAddress(nextAddress);
      tracked.set(normalizedAddress, {
        address: normalizedAddress,
        requirements: normalizeRequirements(nextRequirements),
      });
    },
    removeAddress(nextAddress) {
      tracked.delete(getAddress(nextAddress));
    },
    async checkNow() {
      if (checking) return [];
      checking = true;

      try {
        const hits = await collectHits(provider, [...tracked.values()]);
        for (const hit of hits) tracked.delete(hit.address);
        if (hits.length > 0) await callback(hits);
        return hits;
      } finally {
        checking = false;
      }
    },
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void controller.checkNow();
      }, intervalMs);
      void controller.checkNow();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };

  controller.addAddress(address, requirements);
  if (options.autoStart !== false) controller.start();

  return controller;
}

async function collectHits(provider: Provider, tracked: TrackedAddress[]): Promise<PaymentHit[]> {
  const hits: PaymentHit[] = [];

  for (const item of tracked) {
    const balances: PaymentBalance[] = [];

    for (const requirement of item.requirements) {
      const balance = await readBalance(provider, item.address, requirement.token);
      if (balance >= requirement.minBalance) {
        balances.push({
          token: requirement.token,
          balance,
          minBalance: requirement.minBalance,
        });
      }
    }

    if (balances.length === item.requirements.length) {
      hits.push({ address: item.address, balances });
    }
  }

  return hits;
}

async function readBalance(provider: Provider, address: string, token: string): Promise<bigint> {
  if (token === NATIVE_TOKEN) return provider.getBalance(address);

  const erc20 = new Contract(token, ERC20_ABI, provider);
  return erc20.balanceOf(address);
}

function normalizeRequirements(requirements: PaymentRequirement[]): NormalizedRequirement[] {
  if (requirements.length === 0) {
    throw new Error("At least one payment requirement is required");
  }

  return requirements.map((requirement) => ({
    token: requirement.token ? getAddress(requirement.token) : NATIVE_TOKEN,
    minBalance: BigInt(requirement.minBalance.toString()),
  }));
}
