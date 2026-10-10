/**
 * Loads realistic sample data for development and demos:
 *   npm run seed -w @sakthimaan/api              # only into an empty database
 *   npm run seed -w @sakthimaan/api -- --reset   # wipe a LOCAL database first
 *   ... -- --reset --yes-wipe-database           # required to wipe a non-local (e.g. Atlas dev) database
 *
 * Creates one user per role, store settings, seasons, zones/states/transport partners,
 * 10 categories, ~50 products, gift boxes, customers and orders in every status.
 * Stock changes go through InventoryService, so ledgers match stock exactly.
 * Refuses to run when NODE_ENV=production.
 */
import bcrypt from 'bcryptjs';
import mongoose, { type Types } from 'mongoose';
import {
  INDIAN_STATES,
  ROLES,
  ROLE_LABELS,
  counterKey,
  financialYearOf,
  priceOrder,
  type IndianStateCode,
  type OrderStatus,
  type Role,
} from '@sakthimaan/shared';
import { connectDb, disconnectDb } from '../config/db.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import {
  CategoryModel,
  CounterModel,
  CustomerModel,
  OrderActivityModel,
  OrderModel,
  PaymentModel,
  ProductModel,
  SETTINGS_ID,
  SeasonModel,
  ServiceStateModel,
  SettingsModel,
  TransportPartnerModel,
  UserModel,
  ZoneModel,
} from '../models/index.js';
import { AuditService } from '../services/audit.service.js';
import { InventoryService } from '../services/catalog/inventory.service.js';
import { withTransaction } from '../utils/transaction.js';

export const SEED_PASSWORD = 'Sakthimaan@2026';
const SEED_USERS: Record<Role, { name: string; email: string }> = {
  super_admin: { name: 'Karthik Raja', email: 'super@sakthimaan.test' },
  admin: { name: 'Meena Sundaram', email: 'admin@sakthimaan.test' },
  staff_orders: { name: 'Prakash Kumar', email: 'orders@sakthimaan.test' },
  staff_inventory: { name: 'Selvam Murugan', email: 'inventory@sakthimaan.test' },
  viewer: { name: 'Divya Anand', email: 'viewer@sakthimaan.test' },
};

const rupees = (r: number) => Math.round(r * 100);
const daysAgo = (d: number, hour = 11) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(hour, (d * 7) % 60, 0, 0);
  return t;
};

// ------------------------------------------------------------------ catalogue data

interface P {
  name: string;
  sku: string;
  mrp: number;
  disc?: number;
  unit?: 'box' | 'pkt' | 'piece';
  pcs?: number;
  stock: number;
  green?: boolean;
  sound?: 'none' | 'low' | 'medium' | 'high' | 'very_high';
  age?: number;
  sub?: string;
  warn?: string;
  draft?: boolean;
  batches?: boolean;
}

const CATALOGUE: { name: string; subs?: string[]; products: P[] }[] = [
  {
    name: 'Sparklers',
    subs: ['7cm', '10cm', '12cm', '15cm'],
    products: [
      {
        name: '7cm Electric Sparkler',
        sku: 'SP-07-ELEC',
        mrp: 199,
        disc: 82.5,
        pcs: 10,
        stock: 480,
        green: true,
        age: 6,
        sub: '7cm',
      },
      {
        name: '7cm Colour Sparkler',
        sku: 'SP-07-COL',
        mrp: 220,
        pcs: 10,
        stock: 350,
        green: true,
        age: 6,
        sub: '7cm',
      },
      {
        name: '10cm Electric Sparkler',
        sku: 'SP-10-ELEC',
        mrp: 299,
        pcs: 10,
        stock: 260,
        green: true,
        age: 6,
        sub: '10cm',
      },
      {
        name: '10cm Red Sparkler',
        sku: 'SP-10-RED',
        mrp: 320,
        pcs: 10,
        stock: 0,
        green: true,
        age: 6,
        sub: '10cm',
      },
      {
        name: '12cm Green Sparkler',
        sku: 'SP-12-GRN',
        mrp: 380,
        pcs: 10,
        stock: 140,
        green: true,
        age: 8,
        sub: '12cm',
      },
      {
        name: '15cm Electric Sparkler',
        sku: 'SP-15-ELEC',
        mrp: 450,
        pcs: 10,
        stock: 8,
        green: true,
        age: 8,
        sub: '15cm',
      },
      {
        name: '30cm Electric Sparkler',
        sku: 'SP-30-ELEC',
        mrp: 950,
        pcs: 5,
        stock: 60,
        age: 10,
        warn: 'Hold at arm length.',
      },
      {
        name: '50cm Electric Sparkler',
        sku: 'SP-50-ELEC',
        mrp: 1450,
        pcs: 5,
        stock: 25,
        age: 12,
        warn: 'Hold at arm length.',
      },
    ],
  },
  {
    name: 'Flower Pots',
    products: [
      {
        name: 'Flower Pot Small',
        sku: 'FP-SMALL',
        mrp: 300,
        pcs: 10,
        stock: 220,
        green: true,
        sound: 'low',
        age: 10,
      },
      {
        name: 'Flower Pot Big',
        sku: 'FP-BIG',
        mrp: 450,
        pcs: 10,
        stock: 180,
        green: true,
        sound: 'low',
        age: 12,
      },
      {
        name: 'Flower Pot Special',
        sku: 'FP-SPECIAL',
        mrp: 650,
        pcs: 10,
        stock: 90,
        sound: 'low',
        age: 12,
        batches: true,
      },
      { name: 'Flower Pot Deluxe', sku: 'FP-DELUXE', mrp: 990, pcs: 5, stock: 12, sound: 'low', age: 12 },
      {
        name: 'Colour Koti (Tri-colour)',
        sku: 'FP-KOTI',
        mrp: 1600,
        pcs: 10,
        stock: 40,
        sound: 'low',
        age: 14,
      },
    ],
  },
  {
    name: 'Ground Chakkars',
    products: [
      {
        name: 'Ground Chakkar Big',
        sku: 'GC-BIG',
        mrp: 250,
        pcs: 10,
        stock: 300,
        green: true,
        sound: 'low',
        age: 8,
      },
      {
        name: 'Ground Chakkar Asoka',
        sku: 'GC-ASOKA',
        mrp: 420,
        pcs: 10,
        stock: 150,
        green: true,
        sound: 'low',
        age: 8,
      },
      {
        name: 'Ground Chakkar Special',
        sku: 'GC-SPECIAL',
        mrp: 520,
        pcs: 10,
        stock: 6,
        sound: 'low',
        age: 10,
      },
      {
        name: 'Ground Chakkar Deluxe (25 pcs)',
        sku: 'GC-DELUXE25',
        mrp: 1150,
        pcs: 25,
        stock: 45,
        sound: 'low',
        age: 10,
      },
    ],
  },
  {
    name: 'Rockets',
    products: [
      {
        name: 'Baby Rocket',
        sku: 'RK-BABY',
        mrp: 280,
        unit: 'pkt',
        pcs: 10,
        stock: 200,
        sound: 'medium',
        age: 14,
        warn: 'Launch from a bottle in open space.',
      },
      {
        name: 'Lunik Rocket',
        sku: 'RK-LUNIK',
        mrp: 750,
        unit: 'pkt',
        pcs: 10,
        stock: 120,
        sound: 'high',
        age: 14,
        warn: 'Launch from a bottle in open space.',
      },
      {
        name: 'Whistling Rocket',
        sku: 'RK-WHISTLE',
        mrp: 820,
        unit: 'pkt',
        pcs: 10,
        stock: 75,
        sound: 'high',
        age: 14,
      },
      {
        name: 'Two Sound Rocket',
        sku: 'RK-2SOUND',
        mrp: 980,
        unit: 'pkt',
        pcs: 10,
        stock: 0,
        sound: 'very_high',
        age: 16,
      },
      {
        name: 'Parachute Rocket',
        sku: 'RK-PARACHUTE',
        mrp: 1250,
        unit: 'pkt',
        pcs: 5,
        stock: 30,
        sound: 'medium',
        age: 14,
        draft: true,
      },
    ],
  },
  {
    name: 'Bombs',
    subs: ['Atom Bombs', 'Hydro & Bijili'],
    products: [
      {
        name: 'Atom Bomb (Big)',
        sku: 'BM-ATOM-BIG',
        mrp: 420,
        pcs: 10,
        stock: 260,
        sound: 'very_high',
        age: 16,
        sub: 'Atom Bombs',
      },
      {
        name: 'Atom Bomb Green',
        sku: 'BM-ATOM-GRN',
        mrp: 460,
        pcs: 10,
        stock: 190,
        green: true,
        sound: 'high',
        age: 16,
        sub: 'Atom Bombs',
      },
      {
        name: 'Hydro Bomb',
        sku: 'BM-HYDRO',
        mrp: 560,
        pcs: 10,
        stock: 140,
        sound: 'very_high',
        age: 16,
        sub: 'Hydro & Bijili',
      },
      {
        name: 'Red Bijili (100 pcs)',
        sku: 'BM-BIJILI100',
        mrp: 320,
        unit: 'pkt',
        pcs: 100,
        stock: 400,
        sound: 'high',
        age: 14,
        sub: 'Hydro & Bijili',
      },
      { name: 'Classic Bomb', sku: 'BM-CLASSIC', mrp: 380, pcs: 10, stock: 9, sound: 'very_high', age: 16 },
      { name: 'Digital Bomb', sku: 'BM-DIGITAL', mrp: 690, pcs: 10, stock: 70, sound: 'very_high', age: 16 },
    ],
  },
  {
    name: 'Fancy / Aerial Shots',
    products: [
      {
        name: '7 Shot Multicolour',
        sku: 'AS-7SHOT',
        mrp: 690,
        pcs: 1,
        unit: 'piece',
        stock: 120,
        sound: 'medium',
        age: 16,
      },
      {
        name: '12 Shot Fancy',
        sku: 'AS-12SHOT',
        mrp: 1290,
        pcs: 1,
        unit: 'piece',
        stock: 80,
        sound: 'high',
        age: 16,
      },
      {
        name: '30 Shot Rainbow',
        sku: 'AS-30SHOT',
        mrp: 2490,
        pcs: 1,
        unit: 'piece',
        stock: 35,
        sound: 'high',
        age: 18,
      },
      {
        name: '60 Shot Celebration',
        sku: 'AS-60SHOT',
        mrp: 4890,
        pcs: 1,
        unit: 'piece',
        stock: 14,
        sound: 'high',
        age: 18,
      },
      {
        name: '120 Shot Grand Finale',
        sku: 'AS-120SHOT',
        mrp: 8990,
        pcs: 1,
        unit: 'piece',
        stock: 6,
        sound: 'very_high',
        age: 18,
      },
      {
        name: 'Peacock Fountain',
        sku: 'AS-PEACOCK',
        mrp: 1890,
        pcs: 1,
        unit: 'piece',
        stock: 40,
        sound: 'low',
        age: 14,
      },
    ],
  },
  {
    name: 'Kids Special',
    products: [
      { name: 'Pencil Sparkler', sku: 'KD-PENCIL', mrp: 180, pcs: 10, stock: 300, green: true, age: 6 },
      { name: 'Magic Snake Tablets', sku: 'KD-SNAKE', mrp: 120, pcs: 10, stock: 260, green: true, age: 6 },
      {
        name: 'Colour Matches',
        sku: 'KD-MATCH',
        mrp: 90,
        unit: 'pkt',
        pcs: 10,
        stock: 500,
        green: true,
        age: 6,
      },
      {
        name: 'Cartoon Fountain',
        sku: 'KD-CARTOON',
        mrp: 260,
        pcs: 5,
        stock: 110,
        green: true,
        sound: 'low',
        age: 8,
      },
      { name: 'Whistle Wheel (Kids)', sku: 'KD-WHISTLE', mrp: 310, pcs: 5, stock: 4, sound: 'low', age: 8 },
    ],
  },
  {
    name: 'Twinkling & Novelty',
    products: [
      { name: 'Twinkling Star', sku: 'NV-TWINKLE', mrp: 240, pcs: 10, stock: 200, green: true, age: 8 },
      { name: 'Butterfly', sku: 'NV-BUTTERFLY', mrp: 330, pcs: 10, stock: 150, sound: 'low', age: 10 },
      { name: 'Helicopter', sku: 'NV-HELI', mrp: 390, pcs: 5, stock: 95, sound: 'low', age: 10 },
      {
        name: 'Drone (Flying Saucer)',
        sku: 'NV-DRONE',
        mrp: 560,
        pcs: 5,
        stock: 55,
        sound: 'low',
        age: 12,
        draft: true,
      },
      { name: 'Colour Smoke', sku: 'NV-SMOKE', mrp: 290, pcs: 5, stock: 80, green: true, age: 10 },
    ],
  },
  {
    name: 'Garlands (Wala)',
    products: [
      { name: '100 Wala', sku: 'WL-100', mrp: 350, unit: 'piece', stock: 220, sound: 'high', age: 16 },
      { name: '1000 Wala', sku: 'WL-1000', mrp: 1990, unit: 'piece', stock: 70, sound: 'very_high', age: 18 },
      { name: '2000 Wala', sku: 'WL-2000', mrp: 3690, unit: 'piece', stock: 30, sound: 'very_high', age: 18 },
      { name: '5000 Wala', sku: 'WL-5000', mrp: 8490, unit: 'piece', stock: 7, sound: 'very_high', age: 18 },
      {
        name: '10000 Wala',
        sku: 'WL-10000',
        mrp: 15990,
        unit: 'piece',
        stock: 3,
        sound: 'very_high',
        age: 18,
      },
    ],
  },
  { name: 'Gift Boxes', products: [] },
];

const GIFT_BOXES = [
  {
    name: 'Mini Family Box (15 items)',
    sku: 'GB-MINI',
    stock: 80,
    disc: 82,
    items: [
      ['SP-07-ELEC', 2],
      ['FP-SMALL', 1],
      ['GC-BIG', 1],
      ['KD-SNAKE', 1],
      ['KD-MATCH', 2],
    ],
  },
  {
    name: 'Kids Delight Box',
    sku: 'GB-KIDS',
    stock: 60,
    disc: 82,
    items: [
      ['KD-PENCIL', 2],
      ['KD-CARTOON', 1],
      ['NV-TWINKLE', 2],
      ['SP-07-COL', 2],
      ['KD-SNAKE', 2],
    ],
  },
  {
    name: 'Family Celebration Box (30 items)',
    sku: 'GB-FAMILY',
    stock: 45,
    disc: 83,
    items: [
      ['SP-10-ELEC', 2],
      ['FP-BIG', 2],
      ['GC-ASOKA', 2],
      ['RK-BABY', 1],
      ['BM-ATOM-GRN', 1],
      ['NV-BUTTERFLY', 1],
      ['WL-100', 2],
    ],
  },
  {
    name: 'Premium Diwali Box (50 items)',
    sku: 'GB-PREMIUM',
    stock: 9,
    disc: 83,
    items: [
      ['SP-15-ELEC', 2],
      ['FP-SPECIAL', 2],
      ['GC-SPECIAL', 2],
      ['RK-LUNIK', 1],
      ['AS-12SHOT', 1],
      ['WL-1000', 1],
      ['NV-HELI', 2],
    ],
  },
] as const;

const CUSTOMERS: {
  name: string;
  phone: string;
  city: string;
  state: IndianStateCode;
  pincode: string;
  line1: string;
  email?: string;
  credit?: boolean;
}[] = [
  {
    name: 'Ravi Shankar',
    phone: '9842012345',
    city: 'Madurai',
    state: 'TN',
    pincode: '625001',
    line1: '14, North Veli Street',
    email: 'ravi.shankar@example.com',
    credit: true,
  },
  {
    name: 'Lakshmi Narayanan',
    phone: '9443056789',
    city: 'Chennai',
    state: 'TN',
    pincode: '600040',
    line1: '22, 3rd Avenue, Anna Nagar',
  },
  {
    name: 'Suresh Babu',
    phone: '9790123456',
    city: 'Coimbatore',
    state: 'TN',
    pincode: '641002',
    line1: '8, Cross Cut Road',
  },
  {
    name: 'Anitha Krishnan',
    phone: '9894567890',
    city: 'Tiruchirappalli',
    state: 'TN',
    pincode: '620017',
    line1: '5, Thillai Nagar 4th Cross',
  },
  {
    name: 'Manjunath Gowda',
    phone: '9845011122',
    city: 'Bengaluru',
    state: 'KA',
    pincode: '560011',
    line1: '41, 9th Main, Jayanagar',
    email: 'manju.g@example.com',
  },
  {
    name: 'Arun Menon',
    phone: '9447033344',
    city: 'Kochi',
    state: 'KL',
    pincode: '682016',
    line1: 'Door 12/340, MG Road',
  },
  {
    name: 'Srinivas Reddy',
    phone: '9848055566',
    city: 'Hyderabad',
    state: 'TS',
    pincode: '500034',
    line1: 'Plot 77, Road No. 12, Banjara Hills',
  },
  {
    name: 'Venkatesh Rao',
    phone: '9866077788',
    city: 'Vijayawada',
    state: 'AP',
    pincode: '520010',
    line1: '3-14, Benz Circle',
  },
  {
    name: 'Priya Dharshini',
    phone: '9600098765',
    city: 'Salem',
    state: 'TN',
    pincode: '636007',
    line1: '19, Fairlands',
  },
  {
    name: 'Mohammed Irfan',
    phone: '9787012398',
    city: 'Puducherry',
    state: 'PY',
    pincode: '605001',
    line1: '7, Mission Street',
  },
];

// ------------------------------------------------------------------ run

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Host(s) and database name from a MongoDB URI, without credentials. */
export function describeMongoUri(uri: string): { hosts: string[]; database: string; isLocal: boolean } {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const afterCreds = withoutScheme.includes('@')
    ? withoutScheme.slice(withoutScheme.lastIndexOf('@') + 1)
    : withoutScheme;
  const [hostPart = '', rest = ''] = afterCreds.split('/', 2);
  const hosts = hostPart
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const database = decodeURIComponent(rest.split('?')[0] ?? '') || 'test';
  const isLocal =
    !uri.startsWith('mongodb+srv://') &&
    hosts.length > 0 &&
    hosts.every((h) => LOCAL_HOSTS.has(h.replace(/:\d+$/, '').toLowerCase()));
  return { hosts, database, isLocal };
}

async function run(): Promise<void> {
  // Checked before anything else (even before env validation, which differs in production).
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: NODE_ENV=production. The seed script is for development and demos only.');
    process.exitCode = 1;
    return;
  }
  const env = loadEnv();
  const reset = process.argv.includes('--reset');
  const confirmed = process.argv.includes('--yes-wipe-database');
  const target = describeMongoUri(env.MONGODB_URI);

  console.log(
    `Target database: ${target.database} on ${target.hosts.join(', ')}${target.isLocal ? ' (local)' : ' (REMOTE)'}`,
  );
  if (reset && !target.isLocal && !confirmed) {
    console.error(
      'Refusing to wipe a non-local database without confirmation.\n' +
        `Re-run with --reset --yes-wipe-database if you really want to erase "${target.database}" on ${target.hosts.join(', ')}.`,
    );
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ ...env, LOG_LEVEL: 'warn' });
  await connectDb(env.MONGODB_URI, logger, { autoIndex: false });
  try {
    if (reset) {
      await mongoose.connection.dropDatabase();
      console.log('Database wiped.');
    } else if (await UserModel.exists({})) {
      console.error('The database already has data. Run with --reset to wipe it first (development only).');
      process.exitCode = 1;
      return;
    }
    for (const model of Object.values(mongoose.models)) await model.syncIndexes();

    const system = { name: 'Seed script' };
    const inventory = new InventoryService(new AuditService(logger));

    // Users
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, env.BCRYPT_COST);
    const users = new Map<Role, Types.ObjectId>();
    for (const role of ROLES) {
      const u = await UserModel.create({
        ...SEED_USERS[role],
        role,
        passwordHash,
        passwordChangedAt: new Date(),
      });
      users.set(role, u._id);
    }
    const staff = {
      user: String(users.get('staff_orders')),
      name: SEED_USERS.staff_orders.name,
      role: 'staff_orders',
    };
    const store = {
      user: String(users.get('staff_inventory')),
      name: SEED_USERS.staff_inventory.name,
      role: 'staff_inventory',
    };

    // Settings, seasons
    await SettingsModel.create({
      _id: SETTINGS_ID,
      company: {
        name: 'Sakthimaan Crackers',
        legalName: 'Sakthimaan Fireworks Traders',
        address: {
          line1: '12, Sattur Main Road',
          city: 'Sivakasi',
          district: 'Virudhunagar',
          stateCode: 'TN',
          pincode: '626123',
        },
        phones: ['9443011223', '9443044556'],
        whatsappNumber: '9443011223',
        email: 'orders@sakthimaan.test',
        gstin: '33ABCDE1234F1Z5',
        licenseNumber: 'LE/SVK/2026/0457',
      },
      storefront: {
        isOpen: true,
        orderMode: 'enquiry',
        announcement: { text: 'Diwali 2026 orders open: up to 85% off!', isActive: true },
      },
      payment: {
        upiId: 'sakthimaan@okaxis',
        upiPayeeName: 'Sakthimaan Crackers',
        bank: {
          accountName: 'Sakthimaan Fireworks Traders',
          accountNumber: '50200012345678',
          ifsc: 'HDFC0001234',
          bankName: 'HDFC Bank',
          branch: 'Sivakasi',
        },
      },
    });
    await SeasonModel.create([
      {
        name: 'Diwali 2025',
        festivalDate: new Date('2025-10-20'),
        startDate: new Date('2025-09-10'),
        endDate: new Date('2025-10-25'),
      },
      {
        name: 'Diwali 2026',
        festivalDate: new Date('2026-11-08'),
        startDate: new Date('2026-09-15'),
        endDate: new Date('2026-11-15'),
      },
    ]);

    // Shipping
    const [zTn, zSouth, zRest] = await ZoneModel.create([
      {
        name: 'Tamil Nadu',
        minOrderValue: rupees(2000),
        deliveryChargeMode: 'to_pay',
        sortOrder: 1,
        estimatedDeliveryDays: { min: 2, max: 4 },
      },
      {
        name: 'South India',
        minOrderValue: rupees(3000),
        deliveryChargeMode: 'to_pay',
        sortOrder: 2,
        estimatedDeliveryDays: { min: 3, max: 6 },
      },
      {
        name: 'Rest of India',
        minOrderValue: rupees(5000),
        deliveryChargeMode: 'to_pay',
        sortOrder: 3,
        estimatedDeliveryDays: { min: 5, max: 10 },
      },
    ]);
    const south = ['KL', 'KA', 'AP', 'TS', 'PY'];
    await ServiceStateModel.create(
      INDIAN_STATES.map((s) => ({
        code: s.code,
        name: s.name,
        gstCode: s.gstCode,
        zone: s.code === 'TN' ? zTn?._id : south.includes(s.code) ? zSouth?._id : zRest?._id,
        isServiceable: s.code === 'TN' || south.includes(s.code),
      })),
    );
    await TransportPartnerModel.create([
      {
        name: 'KPN Parcel Service',
        phones: ['9443300011'],
        servedStates: ['TN', 'KA', 'KL', 'AP', 'TS', 'PY'],
        sortOrder: 1,
      },
      { name: 'ST Courier', phones: ['9443300022'], servedStates: ['TN', 'KA', 'KL'], sortOrder: 2 },
      { name: 'Sri Murugan Transports', phones: ['9443300033'], servedStates: ['TN'], sortOrder: 3 },
    ]);

    // Categories
    const catIds = new Map<string, Types.ObjectId>();
    let catOrder = 10;
    for (const c of CATALOGUE) {
      const root = await CategoryModel.create({ name: c.name, slug: slug(c.name), sortOrder: catOrder });
      catOrder += 10;
      catIds.set(c.name, root._id);
      for (const [i, s] of (c.subs ?? []).entries()) {
        const sub = await CategoryModel.create({
          name: s,
          slug: slug(`${c.name}-${s}`),
          parent: root._id,
          sortOrder: (i + 1) * 10,
        });
        catIds.set(`${c.name}>${s}`, sub._id);
      }
    }

    // Products + opening stock
    const products = new Map<
      string,
      {
        _id: Types.ObjectId;
        name: string;
        sku: string;
        mrp: number;
        discountPct: number;
        netPrice: number;
        unit: 'box' | 'pkt' | 'piece';
        contentsCount: number;
        isGreen: boolean;
        category: string;
      }
    >();
    let order = 1;
    for (const c of CATALOGUE) {
      for (const p of c.products) {
        const doc = await ProductModel.create({
          name: p.name,
          slug: slug(p.name),
          sku: p.sku,
          category: catIds.get(c.name),
          subCategory: p.sub ? catIds.get(`${c.name}>${p.sub}`) : null,
          mrp: rupees(p.mrp),
          discountPct: p.disc ?? 80,
          unit: p.unit ?? 'box',
          contentsCount: p.pcs ?? 1,
          lowStockThreshold: 10,
          isGreen: p.green ?? false,
          soundLevel: p.sound ?? 'none',
          minAge: p.age,
          safetyWarning: p.warn ?? 'Light at arm length. Adult supervision required.',
          isActive: !p.draft,
          isFeatured: order % 7 === 1,
          trackBatches: p.batches ?? false,
          sortOrder: order++,
          createdBy: users.get('admin'),
        });
        products.set(p.sku, {
          _id: doc._id,
          name: doc.name,
          sku: doc.sku,
          mrp: doc.mrp,
          discountPct: doc.discountPct,
          netPrice: doc.netPrice,
          unit: doc.unit,
          contentsCount: doc.contentsCount ?? 1,
          isGreen: doc.isGreen,
          category: c.name,
        });
        if (p.stock > 0) {
          await withTransaction((session) =>
            inventory.apply(
              {
                productId: doc._id,
                type: 'stock_in',
                qty: p.stock,
                reason: 'Opening stock',
                refType: 'manual',
                ...(p.batches ? { lot: { lotNumber: 'SVK-2026-A1', supplier: 'Sivakasi Unit 1' } } : {}),
              },
              store,
              session,
            ),
          );
        }
      }
    }

    // Gift boxes
    for (const g of GIFT_BOXES) {
      const items = g.items.map(([sku, qty]) => ({ product: products.get(sku)?._id, qty }));
      const mrp = g.items.reduce((s, [sku, qty]) => s + (products.get(sku)?.mrp ?? 0) * qty, 0);
      const box = await ProductModel.create({
        name: g.name,
        slug: slug(g.name),
        sku: g.sku,
        type: 'combo',
        category: catIds.get('Gift Boxes'),
        mrp: Math.ceil(mrp / 100) * 100,
        discountPct: g.disc,
        unit: 'box',
        contentsCount: 1,
        comboItems: items,
        isFeatured: true,
        sortOrder: order++,
        createdBy: users.get('admin'),
      });
      products.set(g.sku, {
        _id: box._id,
        name: box.name,
        sku: box.sku,
        mrp: box.mrp,
        discountPct: box.discountPct,
        netPrice: box.netPrice,
        unit: 'box',
        contentsCount: 1,
        isGreen: false,
        category: 'Gift Boxes',
      });
      await withTransaction((session) =>
        inventory.apply(
          { productId: box._id, type: 'stock_in', qty: g.stock, reason: 'Opening stock', refType: 'manual' },
          store,
          session,
        ),
      );
    }

    // Customers
    const customers = await CustomerModel.create(
      CUSTOMERS.map((c) => ({
        name: c.name,
        phone: c.phone,
        email: c.email,
        creditAllowed: c.credit ?? false,
        addresses: [
          {
            label: 'Home',
            isDefault: true,
            address: { line1: c.line1, city: c.city, stateCode: c.state, pincode: c.pincode },
          },
        ],
      })),
    );

    // Orders in every status
    const plan: { c: number; status: OrderStatus; days: number; lines: [string, number][] }[] = [
      {
        c: 0,
        status: 'enquiry',
        days: 0,
        lines: [
          ['SP-07-ELEC', 10],
          ['FP-BIG', 5],
          ['GB-FAMILY', 1],
        ],
      },
      {
        c: 1,
        status: 'enquiry',
        days: 0,
        lines: [
          ['RK-LUNIK', 4],
          ['BM-ATOM-GRN', 6],
          ['WL-1000', 2],
        ],
      },
      {
        c: 4,
        status: 'enquiry',
        days: 1,
        lines: [
          ['AS-30SHOT', 2],
          ['GC-ASOKA', 10],
          ['SP-15-ELEC', 12],
        ],
      },
      {
        c: 6,
        status: 'enquiry',
        days: 1,
        lines: [
          ['GB-PREMIUM', 6],
          ['KD-PENCIL', 10],
        ],
      },
      {
        c: 8,
        status: 'enquiry',
        days: 2,
        lines: [
          ['FP-SMALL', 8],
          ['NV-TWINKLE', 6],
          ['KD-SNAKE', 10],
        ],
      },
      {
        c: 2,
        status: 'confirmed',
        days: 2,
        lines: [
          ['SP-10-ELEC', 10],
          ['GC-BIG', 10],
          ['RK-BABY', 5],
        ],
      },
      {
        c: 5,
        status: 'confirmed',
        days: 3,
        lines: [
          ['GB-FAMILY', 2],
          ['WL-100', 10],
        ],
      },
      {
        c: 3,
        status: 'payment_received',
        days: 4,
        lines: [
          ['FP-SPECIAL', 4],
          ['AS-12SHOT', 2],
          ['BM-HYDRO', 5],
        ],
      },
      {
        c: 7,
        status: 'payment_received',
        days: 5,
        lines: [
          ['GB-KIDS', 3],
          ['KD-CARTOON', 4],
        ],
      },
      {
        c: 0,
        status: 'packed',
        days: 6,
        lines: [
          ['GB-MINI', 4],
          ['SP-07-COL', 10],
        ],
      },
      {
        c: 9,
        status: 'dispatched',
        days: 8,
        lines: [
          ['AS-7SHOT', 4],
          ['BM-BIJILI100', 6],
          ['FP-BIG', 6],
        ],
      },
      {
        c: 1,
        status: 'delivered',
        days: 12,
        lines: [
          ['SP-07-ELEC', 20],
          ['FP-SMALL', 10],
          ['GC-BIG', 10],
          ['RK-LUNIK', 2],
        ],
      },
      {
        c: 4,
        status: 'delivered',
        days: 16,
        lines: [
          ['GB-PREMIUM', 1],
          ['WL-2000', 1],
        ],
      },
      {
        c: 8,
        status: 'cancelled',
        days: 9,
        lines: [
          ['NV-HELI', 4],
          ['NV-BUTTERFLY', 6],
        ],
      },
    ];
    const fy = financialYearOf(new Date());
    const transports = await TransportPartnerModel.find().lean();
    const flow: OrderStatus[] = [
      'enquiry',
      'confirmed',
      'payment_received',
      'packed',
      'dispatched',
      'delivered',
    ];
    for (const o of plan) {
      const customer = customers[o.c];
      if (!customer) continue;
      const addr = customer.addresses[0]?.address;
      if (!addr) continue;
      const createdAt = daysAgo(o.days, 10 + (o.c % 8));
      const snapshot = o.lines.map(([sku, qty]) => {
        const p = products.get(sku);
        if (!p) throw new Error(`Unknown SKU ${sku}`);
        return { p, qty };
      });
      const pricing = priceOrder({
        lines: snapshot.map(({ p, qty }) => ({
          mrp: p.mrp,
          netPrice: p.netPrice,
          qty,
          hsn: '3604',
          taxRate: 18,
        })),
        chargesHsn: '3604',
        chargesTaxRate: 18,
        sellerStateCode: 'TN',
        buyerStateCode: addr.stateCode,
      });
      await withTransaction(async (session) => {
        const counter = await CounterModel.findOneAndUpdate(
          { _id: counterKey('order', fy) },
          { $inc: { seq: 1 } },
          { upsert: true, returnDocument: 'after', session },
        ).lean();
        const orderNo = `ORD/${fy.short}/${String(counter?.seq ?? 1).padStart(6, '0')}`;
        const reached = o.status === 'cancelled' ? 1 : flow.indexOf(o.status);
        const committed = reached >= 1;
        const paid = reached >= 2 && o.status !== 'cancelled';
        const [order] = await OrderModel.create(
          [
            {
              orderNo,
              status: o.status,
              mode: 'enquiry',
              source: o.c % 3 === 0 ? 'phone' : 'storefront',
              customer: customer._id,
              customerSnapshot: { name: customer.name, phone: customer.phone, email: customer.email },
              shippingAddress: addr,
              zoneName: addr.stateCode === 'TN' ? 'Tamil Nadu' : 'South India',
              items: snapshot.map(({ p, qty }, i) => ({
                product: p._id,
                sku: p.sku,
                name: p.name,
                type: p.sku.startsWith('GB-') ? 'combo' : 'single',
                categoryId: catIds.get(p.category),
                categoryName: p.category,
                unit: p.unit,
                contentsCount: p.contentsCount,
                isGreen: p.isGreen,
                hsn: '3604',
                taxRate: 18,
                mrp: p.mrp,
                discountPct: p.discountPct,
                netPrice: p.netPrice,
                qty,
                ...pricing.lines[i],
              })),
              pricing: {
                ...pricing,
                sellerStateCode: 'TN',
                placeOfSupply: addr.stateCode,
                netPriceRounding: 'nearest_rupee',
              },
              paymentStatus: paid ? 'paid' : 'unpaid',
              amountPaid: paid ? pricing.grandTotal : 0,
              stockCommitted: committed && o.status !== 'cancelled',
              confirmedAt: committed ? createdAt : undefined,
              confirmedBy: committed ? users.get('staff_orders') : undefined,
              cancelledAt: o.status === 'cancelled' ? daysAgo(o.days - 1) : undefined,
              cancelReason: o.status === 'cancelled' ? 'Customer postponed the purchase' : undefined,
              dispatch:
                reached >= 4
                  ? {
                      transportPartner: transports[0]?._id,
                      transportName: transports[0]?.name,
                      lrNumber: `KPN${String(4_500_000 + o.days * 37)}`,
                      dispatchDate: daysAgo(o.days - 2),
                      boxes: 2,
                      destination: addr.city,
                      ...(o.status === 'delivered' ? { deliveredAt: daysAgo(o.days - 5) } : {}),
                    }
                  : undefined,
              createdBy: o.c % 3 === 0 ? users.get('staff_orders') : undefined,
              createdAt,
              updatedAt: createdAt,
            },
          ],
          { session, timestamps: false },
        );
        if (!order) return;
        if (committed) {
          for (const { p, qty } of snapshot) {
            await inventory.apply(
              {
                productId: p._id,
                type: 'order_deduct',
                qty,
                reason: 'Order confirmed',
                refType: 'order',
                refId: order._id,
                refLabel: orderNo,
              },
              staff,
              session,
            );
          }
        }
        if (o.status === 'cancelled') {
          for (const { p, qty } of snapshot) {
            await inventory.apply(
              {
                productId: p._id,
                type: 'order_restock',
                qty,
                reason: 'Order cancelled',
                refType: 'order',
                refId: order._id,
                refLabel: orderNo,
              },
              staff,
              session,
            );
          }
        }
        if (paid) {
          await PaymentModel.create(
            [
              {
                order: order._id,
                orderNo,
                customer: customer._id,
                amount: pricing.grandTotal,
                method: 'upi',
                reference: `UTR${String(400_000_000 + o.days * 7919)}`,
                paidAt: daysAgo(o.days - 1),
                source: 'staff',
                status: 'recorded',
                recordedBy: staff,
                recordedAt: daysAgo(o.days - 1),
              },
            ],
            { session },
          );
        }
        await OrderActivityModel.create(
          [
            {
              order: order._id,
              type: 'status_change',
              toStatus: o.status,
              message: `Seeded as ${o.status.replace('_', ' ')}`,
              actor: system,
            },
          ],
          { session },
        );
        await CustomerModel.updateOne(
          { _id: customer._id },
          {
            $inc: { 'stats.orderCount': 1, 'stats.totalSpent': paid ? pricing.grandTotal : 0 },
            $max: { 'stats.lastOrderAt': createdAt },
          },
          { session },
        );
      });
    }

    const productCount = await ProductModel.countDocuments();
    console.log(
      `\nSeeded: ${await CategoryModel.countDocuments()} categories, ${productCount} products (incl. ${GIFT_BOXES.length} gift boxes),`,
    );
    console.log(`        ${customers.length} customers, ${plan.length} orders, ${ROLES.length} users.\n`);
    console.log(
      'Sign in at http://localhost:5173 with any of these (password for all: ' + SEED_PASSWORD + '):',
    );
    for (const role of ROLES) console.log(`  ${ROLE_LABELS[role].padEnd(18)} ${SEED_USERS[role].email}`);
    console.log('');
  } finally {
    await disconnectDb();
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

run().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
