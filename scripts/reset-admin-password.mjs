/**
 * 重置本地开发环境管理员密码
 * 用法：node scripts/reset-admin-password.mjs [新密码] [邮箱]
 * 例如：node scripts/reset-admin-password.mjs "Admin@123456" "admin@local.dev"
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const newPassword = process.argv[2] || "Admin@123456";
const email = process.argv[3] || "admin@local.dev";

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash(newPassword, 12);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`❌ 用户 ${email} 不存在`);
    console.log("当前所有用户邮箱：");
    const all = await prisma.user.findMany({ select: { email: true, role: true } });
    all.forEach((u) => console.log(`  ${u.email} (${u.role})`));
    process.exit(1);
  }

  await prisma.user.update({
    where: { email },
    data: { passwordHash: hash },
  });

  console.log(`✅ 密码已重置`);
  console.log(`   邮箱：${email}`);
  console.log(`   新密码：${newPassword}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
