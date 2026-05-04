export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export const INVOICE_SWEEPER_ABI = [
  "function getInvoiceAddress(bytes32 invoiceId) view returns (address)",
  "function createInvoice(bytes32 invoiceId) returns (address forwarder)",
  "function sweepEth(bytes32 invoiceId, bytes data) returns (address forwarder, uint256 amount)",
  "function sweepToken(bytes32 invoiceId, address token, bytes data) returns (address forwarder, uint256 amount)",
  "function bulkExecute((bytes32 invoiceId,address token,bytes data)[] calls) returns (uint256[] amounts)",
  "function forwarderImplementation() view returns (address)",
  "function receiver() view returns (address)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
] as const;
