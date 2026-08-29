if (process.env.SEED_PREVIEW_CONFIRM !== "1") {
  console.error("Preview seed confirmation is required.");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");

const SEED_ORGANIZATION_SLUG = "preview-clinic";
const prisma = new PrismaClient();

async function deleteExistingSeed() {
  const organization = await prisma.organization.findUnique({
    where: { slug: SEED_ORGANIZATION_SLUG },
    select: { id: true },
  });

  if (!organization) {
    return;
  }

  const memberships = await prisma.membership.findMany({
    where: { organizationId: organization.id },
    select: { userId: true },
  });
  const userIds = memberships.map(({ userId }) => userId);

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await tx.appointment.deleteMany({ where: { organizationId: organization.id } });
    await tx.patient.deleteMany({ where: { organizationId: organization.id } });
    await tx.invite.deleteMany({ where: { organizationId: organization.id } });
    await tx.professional.deleteMany({ where: { organizationId: organization.id } });
    await tx.membership.deleteMany({ where: { organizationId: organization.id } });

    if (userIds.length > 0) {
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await tx.organization.delete({ where: { id: organization.id } });
  });
}

try {
  await deleteExistingSeed();
} finally {
  await prisma.$disconnect();
}
