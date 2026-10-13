import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export interface ProductCatalogItem {
  id: string;
  category: string;
  product_name: string;
  dimensions: string;
  hsn_code: string;
  min_thickness_mm?: number | null;
  max_thickness_mm?: number | null;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async getAll(): Promise<ProductCatalogItem[]> {
    try {
      const client = this.supabaseService.getAdminClient();
      const { data, error } = await client
        .from('products')
        .select('*')
        .order('category', { ascending: true })
        .order('product_name', { ascending: true });

      if (error) {
        this.logger.warn(`Error querying products table: ${error.message}`);
        return [];
      }

      return data || [];
    } catch (err: any) {
      this.logger.error(`Failed to fetch products: ${err.message}`);
      return [];
    }
  }

  async create(body: {
    product_name?: string;
    dimensions?: string;
    hsn_code?: string;
    category?: string;
  }): Promise<ProductCatalogItem> {
    const productName = String(body?.product_name || '').trim();
    const dimensions = String(body?.dimensions || '').trim();
    const hsnCode = String(body?.hsn_code || '').trim();
    if (!productName || !dimensions || !hsnCode) {
      throw new BadRequestException(
        'Product Name, Specs/Dimensions, and HSN/SAC Code are all required',
      );
    }
    const category = String(body?.category || 'Custom').trim() || 'Custom';

    const client = this.supabaseService.getAdminClient();
    const existingList = await this.getAll();
    const pLower = productName.toLowerCase();
    const dLower = dimensions.toLowerCase();

    const existing = existingList.find(
      (p) =>
        (p.product_name || '').trim().toLowerCase() === pLower &&
        (p.dimensions || '').trim().toLowerCase() === dLower,
    );

    if (existing) {
      if (hsnCode && existing.hsn_code !== hsnCode) {
        const { data: updated, error: updateErr } = await client
          .from('products')
          .update({
            hsn_code: hsnCode,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select('*')
          .single();
        if (!updateErr && updated) {
          return updated;
        }
      }
      return existing;
    }

    const { data, error } = await client
      .from('products')
      .insert({
        category,
        product_name: productName,
        dimensions,
        hsn_code: hsnCode,
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to create product: ${error.message}`);
      throw new BadRequestException(
        error.message || 'Could not add product to catalog',
      );
    }

    return data;
  }

  async findByProductAndDimension(
    productName: string,
    dimensions?: string,
  ): Promise<ProductCatalogItem | null> {
    const products = await this.getAll();
    if (!products.length || !productName) return null;

    const pLower = productName.toLowerCase().trim();
    const dLower = (dimensions || '').toLowerCase().trim();

    // Direct match
    const exact = products.find(
      (p) =>
        p.product_name.toLowerCase() === pLower &&
        (!dimensions || p.dimensions.toLowerCase().includes(dLower)),
    );
    if (exact) return exact;

    // Fuzzy match by product name prefix
    const nameMatch = products.filter(
      (p) =>
        pLower.includes(p.product_name.toLowerCase()) ||
        p.product_name.toLowerCase().includes(pLower),
    );
    if (nameMatch.length === 1) return nameMatch[0];
    if (nameMatch.length > 1) {
      if (dLower) {
        const dimMatch = nameMatch.find((p) =>
          p.dimensions.toLowerCase().includes(dLower),
        );
        if (dimMatch) return dimMatch;
      }
      return nameMatch[0];
    }

    return null;
  }
}
