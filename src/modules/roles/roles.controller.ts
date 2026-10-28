import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';

@Controller()
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @Get('auth/me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentEmployee() employee: any) {
    const fresh = employee?.id
      ? await this.permissionsService.resolve(employee.id, true)
      : null;
    const current = fresh || employee;
    return {
      id: current?.id,
      employee_id: current?.employee_id,
      name: current?.name,
      phone: current?.phone,
      role: current?.role,
      roleName: current?.roleName || current?.role,
      dataScope: current?.dataScope || 'own',
      permissions: current?.permissions || {},
      visibilityScope: current?.visibilityScope || {},
      isActive: current?.isActive !== false,
    };
  }

  @Get('roles/catalog')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('staff.manage_acl')
  catalog() {
    return this.rolesService.catalog();
  }

  @Get('roles')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('staff.view', 'staff.manage_acl')
  list() {
    return this.rolesService.list();
  }

  @Get('roles/:id/assignees')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('staff.manage_acl')
  async assignees(@Param('id') id: string) {
    return { count: await this.rolesService.assignedCount(id) };
  }

  @Post('roles')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('staff.manage_acl')
  create(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.rolesService.create(body, employee);
  }

  @Put('roles/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('staff.manage_acl')
  update(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.rolesService.update(id, body, employee);
  }

  @Delete('roles/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('staff.manage_acl')
  remove(@CurrentEmployee() employee: any, @Param('id') id: string) {
    return this.rolesService.remove(id, employee);
  }
}
