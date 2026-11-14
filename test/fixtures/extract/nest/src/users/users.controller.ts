import { Controller, Get, Post, Delete, Param } from '@nestjs/common';
@Controller('users')
export class UsersController {
  @Get() list() {}
  @Get(':id') one(@Param('id') id: string) { return id; }
  @Post() create() {}
  @Delete(':id') remove() {}
}
