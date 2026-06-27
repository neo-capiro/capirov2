import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../auth/tenant.guard.js';
import { CascadeService } from './cascade.service.js';

/**
 * Cascade + product-catalog endpoints (Phase 3, AC-3.1).
 *
 * Drives Setup's intake cascade: Industry → Product → Pathway → Committee, plus
 * per-product defaults (sections, pages, personalization, funding). All routes
 * are tenant-guarded (read-only catalog, but auth is required for parity).
 *
 * Mounted under the global prefix `workspace-api` (see main.ts), so the ALB
 * rule `/workspace-api/*` lands them.
 */
@Controller('cascade')
@UseGuards(TenantGuard)
export class CascadeController {
  constructor(private readonly cascade: CascadeService) {}

  /** GET /workspace-api/cascade → list of industries. */
  @Get()
  industries(): { industries: string[] } {
    return { industries: this.cascade.industries() };
  }

  /**
   * GET /workspace-api/cascade/:industry/products → products for an industry
   * (industry presets + universal comms docs). ?all=1 returns the 10 canonical.
   */
  @Get(':industry/products')
  products(
    @Param('industry') industry: string,
    @Query('all') all?: string,
  ): { products: string[] } {
    if (all === '1' || all === 'true') {
      return { products: this.cascade.allLibraryProducts() };
    }
    return { products: this.cascade.productsFor(industry) };
  }

  /** GET /workspace-api/cascade/:industry/products/:product/pathways */
  @Get(':industry/products/:product/pathways')
  pathways(
    @Param('industry') industry: string,
    @Param('product') product: string,
  ): { pathways: string[] } {
    return { pathways: this.cascade.pathwaysFor(industry, decodeURIComponent(product)) };
  }

  /**
   * GET /workspace-api/cascade/:industry/committees?pathways=a,b
   * → committees derived from the selected pathways.
   */
  @Get(':industry/committees')
  committees(
    @Param('industry') industry: string,
    @Query('pathways') pathways?: string,
  ): { committees: string[] } {
    const list = (pathways ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    return { committees: this.cascade.committeesFor(industry, list) };
  }
}

/**
 * Product defaults endpoint, mounted at /workspace-api/products/:product/defaults.
 * Separate controller so the route is products/* not cascade/*.
 */
@Controller('products')
@UseGuards(TenantGuard)
export class ProductsController {
  constructor(private readonly cascade: CascadeService) {}

  /**
   * GET /workspace-api/products/:product/defaults → seed values when a product
   * is picked: personalization/office/cover defaults, suggested sections+pages,
   * funding flag, industry platform data is fetched separately.
   */
  @Get(':product/defaults')
  defaults(@Param('product') product: string): {
    product: string;
    personalize: boolean;
    officeAssociated: boolean;
    coverLetter: boolean;
    sections: string[];
    pages: number;
    funding: boolean;
    icon: string;
    description: string;
  } {
    return this.cascade.defaultsFor(decodeURIComponent(product));
  }
}
