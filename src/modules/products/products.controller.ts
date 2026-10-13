import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async getAll() {
    const products = await this.productsService.getAll();
    return { data: products };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Body()
    body: {
      product_name: string;
      dimensions?: string;
      hsn_code?: string;
      category?: string;
    },
  ) {
    const product = await this.productsService.create(body);
    return { data: product };
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
