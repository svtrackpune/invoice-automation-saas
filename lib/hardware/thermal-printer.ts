export type RollWidth = 58 | 80;
export type PrinterTransport = 'bluetooth' | 'usb' | 'none';

export interface PrinterConfig {
  rollWidth: RollWidth;
  autoKickCashDrawer: boolean;
  transport: PrinterTransport;
  bluetoothDeviceId: string | null;
  bluetoothDeviceName: string | null;
  usbVendorId: number | null;
  usbProductId: number | null;
  usbDeviceName: string | null;
}

export interface PrinterConnectionStatus {
  connected: boolean;
  transport: PrinterTransport;
  deviceName: string | null;
  message: string;
}

export interface PrinterPrintResult {
  ok: boolean;
  transport: PrinterTransport;
  usedFallbackDialog: boolean;
  message: string;
}

const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
] as const;

export const PRINTER_CONFIG_KEY = 'moneymatters_printer_config_v1';

const DEFAULT_CONFIG: PrinterConfig = {
  rollWidth: 80,
  autoKickCashDrawer: true,
  transport: 'none',
  bluetoothDeviceId: null,
  bluetoothDeviceName: null,
  usbVendorId: null,
  usbProductId: null,
  usbDeviceName: null,
};

interface BluetoothCharacteristicLike {
  properties: {
    write?: boolean;
    writeWithoutResponse?: boolean;
  };
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
}

interface BluetoothServiceLike {
  getCharacteristics(): Promise<BluetoothCharacteristicLike[]>;
}

interface BluetoothGattServerLike {
  connected: boolean;
  connect?: () => Promise<BluetoothGattServerLike>;
  getPrimaryServices(): Promise<BluetoothServiceLike[]>;
  getPrimaryService?: (service: string) => Promise<BluetoothServiceLike>;
}

interface BluetoothDeviceLike {
  id: string;
  name?: string | null;
  gatt?: BluetoothGattServerLike;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
}

interface BluetoothManagerLike {
  requestDevice(options: {
    acceptAllDevices: boolean;
    optionalServices: string[];
  }): Promise<BluetoothDeviceLike>;
}

interface UsbEndpointLike {
  endpointNumber: number;
  direction: 'in' | 'out';
}

interface UsbAlternateInterfaceLike {
  endpoints?: UsbEndpointLike[];
}

interface UsbInterfaceLike {
  interfaceNumber: number;
  alternates: UsbAlternateInterfaceLike[];
}

interface UsbConfigurationLike {
  interfaces: UsbInterfaceLike[];
}

interface UsbDeviceLike {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  configuration?: { configurationValue: number } | null;
  configurations?: UsbConfigurationLike[];
  open(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ status?: string }>;
  close(): Promise<void>;
}

interface UsbManagerLike {
  requestDevice(options: { filters: Array<Record<string, never>> }): Promise<UsbDeviceLike>;
}

type NavigatorWithHardware = Navigator & {
  bluetooth?: BluetoothManagerLike;
  usb?: UsbManagerLike;
};

function bytes(...parts: number[]): Uint8Array {
  return Uint8Array.from(parts);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function fit(text: string, width: number): string {
  const chars = Array.from(String(text ?? ''));
  return chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join('') + '…' : chars.join('');
}

function padRight(text: string, width: number): string {
  return fit(text, width).padEnd(width, ' ');
}

function padLeft(text: string, width: number): string {
  return fit(text, width).padStart(width, ' ');
}

function normalizeConfig(value: Partial<PrinterConfig> | null | undefined): PrinterConfig {
  const source = value ?? {};
  const rollWidth: RollWidth = source.rollWidth === 58 ? 58 : 80;
  const transport: PrinterTransport =
    source.transport === 'bluetooth' || source.transport === 'usb' ? source.transport : 'none';
  return {
    rollWidth,
    autoKickCashDrawer: source.autoKickCashDrawer !== false,
    transport,
    bluetoothDeviceId: source.bluetoothDeviceId ? String(source.bluetoothDeviceId) : null,
    bluetoothDeviceName: source.bluetoothDeviceName ? String(source.bluetoothDeviceName) : null,
    usbVendorId: Number.isFinite(source.usbVendorId) ? Number(source.usbVendorId) : null,
    usbProductId: Number.isFinite(source.usbProductId) ? Number(source.usbProductId) : null,
    usbDeviceName: source.usbDeviceName ? String(source.usbDeviceName) : null,
  };
}

export class EscPosBuilder {
  private readonly chunks: Uint8Array[] = [];

  private push(value: Uint8Array): this {
    this.chunks.push(value);
    return this;
  }

  init(): this {
    return this.push(bytes(0x1b, 0x40));
  }

  align(alignment: 'left' | 'center' | 'right'): this {
    const value = alignment === 'center' ? 1 : alignment === 'right' ? 2 : 0;
    return this.push(bytes(0x1b, 0x61, value));
  }

  bold(enable: boolean): this {
    return this.push(bytes(0x1b, 0x45, enable ? 1 : 0));
  }

  textSize(width: 1 | 2, height: 1 | 2): this {
    const n = ((width - 1) << 4) | (height - 1);
    return this.push(bytes(0x1d, 0x21, n));
  }

  text(str: string): this {
    return this.push(new TextEncoder().encode(str));
  }

  newLine(count = 1): this {
    const safeCount = clampInt(count, 1, 20);
    return this.push(new Uint8Array(safeCount).fill(0x0a));
  }

  row(col1: string, col2: string, width = 48): this {
    const safeWidth = clampInt(width, 8, 96);
    const leftWidth = Math.max(1, safeWidth - Array.from(String(col2 ?? '')).length - 1);
    const line = padRight(String(col1 ?? ''), leftWidth) + ' ' + padLeft(String(col2 ?? ''), safeWidth - leftWidth - 1);
    return this.text(line).newLine();
  }

  divider(char = '-', width = 48): this {
    const safeWidth = clampInt(width, 8, 96);
    const glyph = Array.from(String(char || '-'))[0] || '-';
    return this.text(glyph.repeat(safeWidth)).newLine();
  }

  kickDrawer(): this {
    return this.push(bytes(0x1b, 0x70, 0x00, 0x19, 0x19));
  }

  cutPaper(partial = false): this {
    return this.newLine(3).push(bytes(0x1d, 0x56, partial ? 0x01 : 0x00));
  }

  getBytes(): Uint8Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

export interface CashBillReceiptItem {
  name: string;
  quantity: number;
  amount: number;
}

export interface CashBillReceiptInput {
  businessName: string;
  invoiceNumber: string;
  cashier: string;
  items: CashBillReceiptItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  tender: 'cash' | 'upi';
  amountReceived: number;
  change: number;
  upiLink?: string | null;
  rollWidth: RollWidth;
}

export function buildCashBillReceipt(input: CashBillReceiptInput): Uint8Array {
  const width = input.rollWidth === 58 ? 32 : 48;
  const money = (value: number) => '₹' + Number(value || 0).toFixed(2);
  const itemNameWidth = width >= 48 ? 25 : 15;
  const qtyWidth = width >= 48 ? 7 : 5;
  const amountWidth = width - itemNameWidth - qtyWidth - 2;
  const builder = new EscPosBuilder()
    .init()
    .align('center')
    .bold(true)
    .textSize(2, 2)
    .text(input.businessName || 'Business')
    .newLine()
    .textSize(1, 1)
    .bold(false)
    .text('CASH BILL')
    .newLine(2)
    .align('left')
    .row('Invoice', input.invoiceNumber, width)
    .row('Cashier', input.cashier || 'Counter', width)
    .divider('-', width);

  for (const item of input.items) {
    const name = padRight(item.name, itemNameWidth);
    const qty = padLeft(String(item.quantity), qtyWidth);
    const amount = padLeft(money(item.amount), amountWidth);
    builder.text(name + ' ' + qty + ' ' + amount).newLine();
  }

  builder
    .divider('-', width)
    .row('Subtotal', money(input.subtotal), width)
    .row('Tax', money(input.tax), width)
    .row('Discount', money(input.discount), width)
    .bold(true)
    .row('GRAND TOTAL', money(input.total), width)
    .bold(false)
    .divider('-', width)
    .row('Tender', input.tender.toUpperCase(), width);

  if (input.tender === 'cash') {
    builder
      .row('Received', money(input.amountReceived), width)
      .row('Change', money(input.change), width);
  } else if (input.upiLink) {
    builder
      .text('UPI PAYMENT LINK')
      .newLine()
      .text(input.upiLink)
      .newLine();
  }

  return builder.align('center').newLine().text('Thank you').newLine(2).cutPaper().getBytes();
}

export class ThermalPrinterService {
  private config: PrinterConfig = { ...DEFAULT_CONFIG };
  private bluetoothDevice: BluetoothDeviceLike | null = null;
  private bluetoothCharacteristic: BluetoothCharacteristicLike | null = null;
  private usbDevice: UsbDeviceLike | null = null;
  private usbEndpoint: number | null = null;

  loadConfig(): PrinterConfig {
    if (typeof window === 'undefined') return { ...this.config };
    try {
      const stored = window.localStorage.getItem(PRINTER_CONFIG_KEY);
      if (stored) this.config = normalizeConfig(JSON.parse(stored) as Partial<PrinterConfig>);
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
    return { ...this.config };
  }

  saveConfig(patch: Partial<PrinterConfig>): PrinterConfig {
    this.config = normalizeConfig({ ...this.config, ...patch });
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PRINTER_CONFIG_KEY, JSON.stringify(this.config));
    }
    return { ...this.config };
  }

  getConfig(): PrinterConfig {
    return { ...this.config };
  }

  supportsBluetooth(): boolean {
    return typeof navigator !== 'undefined' && Boolean((navigator as NavigatorWithHardware).bluetooth);
  }

  supportsUsb(): boolean {
    return typeof navigator !== 'undefined' && Boolean((navigator as NavigatorWithHardware).usb);
  }

  getStatus(): PrinterConnectionStatus {
    if (this.bluetoothDevice?.gatt?.connected && this.bluetoothCharacteristic) {
      return {
        connected: true,
        transport: 'bluetooth',
        deviceName: this.config.bluetoothDeviceName,
        message: this.config.bluetoothDeviceName ? 'Connected' : 'Bluetooth printer connected',
      };
    }
    if (this.usbDevice && this.usbEndpoint !== null) {
      return {
        connected: true,
        transport: 'usb',
        deviceName: this.config.usbDeviceName,
        message: this.config.usbDeviceName ? 'Connected' : 'USB printer connected',
      };
    }
    return {
      connected: false,
      transport: this.config.transport,
      deviceName: this.config.transport === 'bluetooth'
        ? this.config.bluetoothDeviceName
        : this.config.usbDeviceName,
      message: 'Disconnected',
    };
  }

  private async discoverWritableCharacteristic(server: BluetoothGattServerLike): Promise<BluetoothCharacteristicLike> {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      const writable = characteristics.find(
        (characteristic) =>
          characteristic.properties.write === true || characteristic.properties.writeWithoutResponse === true,
      );
      if (writable) return writable;
    }
    throw new Error('No writable Bluetooth printer characteristic was found.');
  }

  async connectBluetooth(): Promise<PrinterConnectionStatus> {
    const manager = typeof navigator !== 'undefined' ? (navigator as NavigatorWithHardware).bluetooth : undefined;
    if (!manager) {
      throw new Error('Web Bluetooth is not supported in this browser. Use Chrome/Edge on a supported device or connect by USB.');
    }

    const device = await manager.requestDevice({
      acceptAllDevices: true,
      optionalServices: [...PRINTER_SERVICES],
    });
    if (!device.gatt) throw new Error('The selected Bluetooth device does not expose a GATT server.');

    const server = device.gatt.connected ? device.gatt : await this.connectGatt(device);
    const characteristic = await this.discoverWritableCharacteristic(server);

    this.bluetoothDevice = device;
    this.bluetoothCharacteristic = characteristic;
    this.usbDevice = null;
    this.usbEndpoint = null;
    this.config = normalizeConfig({
      ...this.config,
      transport: 'bluetooth',
      bluetoothDeviceId: device.id,
      bluetoothDeviceName: device.name || 'Bluetooth thermal printer',
      usbVendorId: null,
      usbProductId: null,
      usbDeviceName: null,
    });
    this.saveConfig(this.config);
    return this.getStatus();
  }

  private async connectGatt(device: BluetoothDeviceLike): Promise<BluetoothGattServerLike> {
    if (!device.gatt) throw new Error('Bluetooth GATT is unavailable.');
    if (device.gatt.connected) return device.gatt;
    if (!device.gatt.connect) throw new Error('This browser does not expose Bluetooth GATT connect().');
    return device.gatt.connect();
  }

  async connectUsb(): Promise<PrinterConnectionStatus> {
    const manager = typeof navigator !== 'undefined' ? (navigator as NavigatorWithHardware).usb : undefined;
    if (!manager) {
      throw new Error('WebUSB is not supported in this browser. Use Chrome/Edge with a compatible USB printer.');
    }

    const device = await manager.requestDevice({ filters: [{}] });
    await device.open();

    const configurations = device.configurations ?? [];
    let selectedConfiguration = device.configuration?.configurationValue ?? null;
    let endpoint: { configurationValue: number; interfaceNumber: number; endpointNumber: number } | null = null;

    for (const configuration of configurations) {
      const configurationValue = (configuration as UsbConfigurationLike & { configurationValue?: number }).configurationValue ?? 1;
      for (const iface of configuration.interfaces) {
        const alternate = iface.alternates[0];
        const outEndpoint = alternate?.endpoints?.find((candidate) => candidate.direction === 'out');
        if (outEndpoint) {
          endpoint = {
            configurationValue,
            interfaceNumber: iface.interfaceNumber,
            endpointNumber: outEndpoint.endpointNumber,
          };
          break;
        }
      }
      if (endpoint) break;
    }

    if (!endpoint) {
      await device.close();
      throw new Error('No writable USB endpoint was found on the selected printer.');
    }

    selectedConfiguration = endpoint.configurationValue;
    if (!device.configuration || device.configuration.configurationValue !== selectedConfiguration) {
      await device.selectConfiguration(selectedConfiguration);
    }
    await device.claimInterface(endpoint.interfaceNumber);

    this.usbDevice = device;
    this.usbEndpoint = endpoint.endpointNumber;
    this.bluetoothDevice = null;
    this.bluetoothCharacteristic = null;
    this.config = normalizeConfig({
      ...this.config,
      transport: 'usb',
      usbVendorId: device.vendorId,
      usbProductId: device.productId,
      usbDeviceName: device.productName || 'USB thermal printer',
      bluetoothDeviceId: null,
      bluetoothDeviceName: null,
    });
    this.saveConfig(this.config);
    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    if (this.usbDevice) {
      try {
        await this.usbDevice.close();
      } catch {
        // Ignore transport cleanup errors.
      }
    }
    this.bluetoothDevice = null;
    this.bluetoothCharacteristic = null;
    this.usbDevice = null;
    this.usbEndpoint = null;
    this.saveConfig({
      transport: 'none',
      bluetoothDeviceId: null,
      bluetoothDeviceName: null,
      usbVendorId: null,
      usbProductId: null,
      usbDeviceName: null,
    });
  }

  private async writeBluetooth(bytesToWrite: Uint8Array): Promise<void> {
    const characteristic = this.bluetoothCharacteristic;
    if (!characteristic) throw new Error('Bluetooth printer is not connected.');

    for (let offset = 0; offset < bytesToWrite.length; offset += 512) {
      const chunk = bytesToWrite.slice(offset, Math.min(offset + 512, bytesToWrite.length));
      if (characteristic.writeValueWithoutResponse) {
        await characteristic.writeValueWithoutResponse(chunk);
      } else if (characteristic.writeValueWithResponse) {
        await characteristic.writeValueWithResponse(chunk);
      } else if (characteristic.writeValue) {
        await characteristic.writeValue(chunk);
      } else {
        throw new Error('Connected Bluetooth characteristic is not writable.');
      }
    }
  }

  private async writeUsb(bytesToWrite: Uint8Array): Promise<void> {
    if (!this.usbDevice || this.usbEndpoint === null) throw new Error('USB printer is not connected.');
    for (let offset = 0; offset < bytesToWrite.length; offset += 512) {
      const chunk = bytesToWrite.slice(offset, Math.min(offset + 512, bytesToWrite.length));
      const result = await this.usbDevice.transferOut(this.usbEndpoint, chunk);
      if (result.status && result.status !== 'ok') throw new Error('USB transfer failed with status: ' + result.status);
    }
  }

  async printBytes(bytesToPrint: Uint8Array, fallbackToDialog = true): Promise<PrinterPrintResult> {
    const status = this.getStatus();
    try {
      if (status.transport === 'bluetooth' && status.connected) {
        await this.writeBluetooth(bytesToPrint);
        return { ok: true, transport: 'bluetooth', usedFallbackDialog: false, message: 'Receipt sent to Bluetooth printer.' };
      }
      if (status.transport === 'usb' && status.connected) {
        await this.writeUsb(bytesToPrint);
        return { ok: true, transport: 'usb', usedFallbackDialog: false, message: 'Receipt sent to USB printer.' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Thermal printer transport failed.';
      if (!fallbackToDialog) return { ok: false, transport: status.transport, usedFallbackDialog: false, message };
    }

    if (fallbackToDialog && typeof window !== 'undefined') {
      window.print();
      return {
        ok: true,
        transport: 'none',
        usedFallbackDialog: true,
        message: 'Thermal printer unavailable; standard print dialog opened.',
      };
    }

    return {
      ok: false,
      transport: 'none',
      usedFallbackDialog: false,
      message: 'No thermal printer is connected.',
    };
  }

  async kickDrawer(): Promise<PrinterPrintResult> {
    return this.printBytes(new EscPosBuilder().kickDrawer().getBytes(), false);
  }
}
