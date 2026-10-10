import type { Types } from 'mongoose';
import type {
  CategoryCreateInput,
  CategoryDto,
  CategoryTreeNode,
  CategoryUpdateInput,
  ReorderInput,
} from '@sakthimaan/shared';
import type { RequestMeta } from '../../middlewares/request-context.js';
import { CategoryModel, ProductModel } from '../../models/index.js';
import { processImage, type StorageProvider } from '../../providers/storage/index.js';
import { badRequest, conflict, notFound } from '../../utils/app-error.js';
import { oid, slugify } from '../../utils/query.js';
import { withTransaction } from '../../utils/transaction.js';
import { diffFields, type AuditActor, type AuditService } from '../audit.service.js';
import { toCategoryDto } from './mappers.js';

const AUDITED_FIELDS = ['name', 'slug', 'parent', 'description', 'hsn', 'taxRate', 'sortOrder', 'isActive'];

export class CategoryService {
  constructor(
    private readonly audit: AuditService,
    private readonly storage: StorageProvider,
  ) {}

  /** Two-level tree, ordered by sortOrder, with product counts (category or sub-category). */
  async tree(opts: { includeInactive: boolean }): Promise<CategoryTreeNode[]> {
    const filter = opts.includeInactive ? {} : { isActive: true };
    const [cats, counts] = await Promise.all([
      CategoryModel.find(filter).sort({ sortOrder: 1, name: 1 }).lean(),
      this.productCounts(),
    ]);
    const roots = cats.filter((c) => !c.parent);
    return roots.map((root) => ({
      ...toCategoryDto(root, counts.get(String(root._id)) ?? 0),
      children: cats
        .filter((c) => c.parent && String(c.parent) === String(root._id))
        .map((c) => toCategoryDto(c, counts.get(String(c._id)) ?? 0)),
    }));
  }

  async get(id: string): Promise<CategoryDto> {
    const cat = await CategoryModel.findById(id).lean();
    if (!cat) throw notFound('Category');
    const counts = await this.productCounts([cat._id]);
    return toCategoryDto(cat, counts.get(String(cat._id)) ?? 0);
  }

  async create(input: CategoryCreateInput, actor: AuditActor, meta: RequestMeta): Promise<CategoryDto> {
    const parent = input.parentId ? await this.assertValidParent(input.parentId) : null;
    const slug = input.slug ?? (await this.uniqueSlug(slugify(input.name)));
    const sortOrder = input.sortOrder ?? (await this.nextSortOrder(parent?._id ?? null));

    return withTransaction(async (session) => {
      const [cat] = await CategoryModel.create(
        [
          {
            name: input.name,
            slug,
            parent: parent?._id ?? null,
            description: input.description,
            hsn: input.hsn ?? null,
            taxRate: input.taxRate ?? null,
            sortOrder,
            isActive: input.isActive ?? true,
          },
        ],
        { session },
      );
      if (!cat) throw new Error('Category not created');
      await this.audit.record(
        { actor, action: 'create', entity: 'category', entityId: String(cat._id), entityLabel: cat.name },
        meta,
        session,
      );
      return toCategoryDto(cat.toObject());
    });
  }

  async update(
    id: string,
    input: CategoryUpdateInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<CategoryDto> {
    const cat = await CategoryModel.findById(id);
    if (!cat) throw notFound('Category');
    const before = cat.toObject();

    if (input.parentId !== undefined) {
      const newParent = input.parentId;
      if (newParent === id) throw badRequest('VALIDATION_ERROR', 'A category cannot be its own parent');
      if (newParent) {
        await this.assertValidParent(newParent);
        if (await CategoryModel.exists({ parent: cat._id })) {
          throw conflict('CONFLICT', 'This category has sub-categories, so it cannot become a sub-category');
        }
      }
      cat.parent = newParent ? oid(newParent) : null;
    }
    if (input.name !== undefined) cat.name = input.name;
    if (input.slug !== undefined) cat.slug = input.slug;
    if (input.description !== undefined) cat.description = input.description;
    if (input.hsn !== undefined) cat.hsn = input.hsn;
    if (input.taxRate !== undefined) cat.taxRate = input.taxRate;
    if (input.sortOrder !== undefined) cat.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) cat.isActive = input.isActive;

    const changes = diffFields(before, cat.toObject(), AUDITED_FIELDS);
    if (changes.length === 0) return this.get(id);

    await withTransaction(async (session) => {
      await cat.save({ session });
      await this.audit.record(
        {
          actor,
          action: 'update',
          entity: 'category',
          entityId: id,
          entityLabel: cat.name,
          changes,
          ...(changes.some((c) => c.path === 'hsn' || c.path === 'taxRate')
            ? { summary: 'Tax override changed: applies to products that inherit from this category' }
            : {}),
        },
        meta,
        session,
      );
    });
    // Read after commit (a read inside the transaction without the session sees old data).
    return this.get(id);
  }

  async reorder(input: ReorderInput, actor: AuditActor, meta: RequestMeta): Promise<void> {
    await withTransaction(async (session) => {
      const res = await CategoryModel.bulkWrite(
        input.items.map((i) => ({
          updateOne: {
            filter: { _id: oid(i.id), isDeleted: false },
            update: { $set: { sortOrder: i.sortOrder } },
          },
        })),
        { session },
      );
      if (res.matchedCount !== input.items.length) throw notFound('One or more categories');
      await this.audit.record(
        {
          actor,
          action: 'bulk_update',
          entity: 'category',
          summary: 'Reordered categories',
          meta: { count: input.items.length },
        },
        meta,
        session,
      );
    });
  }

  /** Soft delete; refused while products or sub-categories still use it. */
  async remove(id: string, actor: AuditActor, meta: RequestMeta): Promise<void> {
    const cat = await CategoryModel.findById(id);
    if (!cat) throw notFound('Category');
    const [children, products] = await Promise.all([
      CategoryModel.countDocuments({ parent: cat._id }),
      ProductModel.countDocuments({ $or: [{ category: cat._id }, { subCategory: cat._id }] }),
    ]);
    if (children > 0 || products > 0) {
      throw conflict(
        'CONFLICT',
        `Move or delete its ${products} product(s) and ${children} sub-categorie(s) first`,
        { products, subCategories: children },
      );
    }
    await withTransaction(async (session) => {
      cat.isDeleted = true;
      cat.deletedAt = new Date();
      cat.deletedBy = actor.user ? oid(actor.user) : null;
      await cat.save({ session });
      await this.audit.record(
        { actor, action: 'delete', entity: 'category', entityId: id, entityLabel: cat.name },
        meta,
        session,
      );
    });
  }

  async setImage(id: string, file: Buffer, actor: AuditActor, meta: RequestMeta): Promise<CategoryDto> {
    const cat = await CategoryModel.findById(id);
    if (!cat) throw notFound('Category');
    const img = await processImage(file);
    const stored = await this.storage.put({ ...img, folder: 'categories' });
    const oldKey = cat.image?.key;
    cat.set('image', { ...stored, alt: cat.name });
    try {
      await cat.save();
    } catch (err) {
      await this.storage.remove(stored.key); // don't leave an orphan behind
      throw err;
    }
    if (oldKey) await this.storage.remove(oldKey).catch(() => undefined);
    await this.audit.record(
      {
        actor,
        action: 'update',
        entity: 'category',
        entityId: id,
        entityLabel: cat.name,
        summary: 'Image changed',
      },
      meta,
    );
    return this.get(id);
  }

  // ------------------------------------------------------------------ helpers

  private async assertValidParent(parentId: string) {
    const parent = await CategoryModel.findById(parentId).lean();
    if (!parent) throw badRequest('VALIDATION_ERROR', 'Parent category not found');
    if (parent.parent)
      throw badRequest('VALIDATION_ERROR', 'Only two levels: a sub-category cannot have children');
    return parent;
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base || 'category';
    for (let i = 1; i < 100; i++) {
      const candidate = i === 1 ? root : `${root}-${i}`;
      if (!(await CategoryModel.exists({ slug: candidate }))) return candidate;
    }
    return `${root}-${Date.now()}`;
  }

  private async nextSortOrder(parent: Types.ObjectId | null): Promise<number> {
    const last = await CategoryModel.findOne({ parent }).sort({ sortOrder: -1 }).select('sortOrder').lean();
    return (last?.sortOrder ?? 0) + 10;
  }

  private async productCounts(ids?: Types.ObjectId[]): Promise<Map<string, number>> {
    const match: Record<string, unknown> = { isDeleted: false };
    if (ids) match.$or = [{ category: { $in: ids } }, { subCategory: { $in: ids } }];
    const rows = await ProductModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: match },
      {
        $project: {
          cats: {
            $setUnion: [
              ['$category'],
              { $cond: [{ $ifNull: ['$subCategory', false] }, ['$subCategory'], []] },
            ],
          },
        },
      },
      { $unwind: '$cats' },
      { $group: { _id: '$cats', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }
}
