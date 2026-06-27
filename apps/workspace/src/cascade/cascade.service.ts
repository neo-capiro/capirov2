import { Injectable } from '@nestjs/common';
import { WSC } from './cascade.config.js';

/**
 * Thin service wrapper around the ported cascade config (cascade.config.ts).
 * Keeps the controller free of static-data imports and gives us a seam for
 * future per-tenant catalog overrides (open question #8: real product catalog).
 */
@Injectable()
export class CascadeService {
  industries(): string[] {
    return WSC.industries();
  }

  productsFor(industry: string): string[] {
    return WSC.productsFor(industry);
  }

  allLibraryProducts(): string[] {
    return WSC.allLibraryProducts();
  }

  pathwaysFor(industry: string, product: string): string[] {
    return WSC.pathwaysFor(industry, product);
  }

  committeesFor(industry: string, pathways: string[]): string[] {
    return WSC.committeesFor(industry, pathways);
  }

  defaultsFor(product: string): {
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
    const meta = WSC.meta(product);
    return {
      product,
      personalize: meta.personalize,
      officeAssociated: meta.office,
      coverLetter: meta.cover,
      sections: WSC.suggestedSections(product),
      pages: WSC.suggestedPages(product),
      funding: WSC.isFunding(product),
      icon: meta.icon,
      description: meta.desc,
    };
  }
}
