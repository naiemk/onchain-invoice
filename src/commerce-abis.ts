export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export const COMMERCE_INVOICE_SWEEPER_ABI = [
  "function getInvoiceAddress(address to, bytes32 invoiceId) view returns (address)",
  "function createInvoice(address to, bytes32 invoiceId) returns (address forwarder)",
  "function sweep(address token, uint256 amount, address to, bytes32 invoiceId) returns (address forwarder, uint256 fee)",
  "function bulkSweep((address token,uint256 amount,address to,bytes32 invoiceId)[] calls) returns (uint256[] fees)",
  "function quoteFee(address token, uint256 amount) view returns (uint256 fee)",
  "function forwarderImplementation() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function minFeeByToken(address token) view returns (uint256)",
  "event InvoiceCreated(bytes32 indexed invoiceId, address indexed to, address indexed forwarder)",
  "event InvoiceSwept(bytes32 indexed invoiceId, address indexed token, address indexed to, address forwarder, uint256 amount, uint256 fee)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
] as const;
