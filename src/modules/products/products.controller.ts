import { Controller, Get, Query } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async getAll() {
    const products = await this.productsService.getAll();
    return { data: products };
  }

  @Get('lookup')
  async lookup(
    @Query('name') name: string,
    @Query('dimensions') dimensions?: string,
  ) {
    const match = await this.productsService.findByProductAndDimension(
      name,
      dimensions,
    );
    return { data: match };
  }
}
