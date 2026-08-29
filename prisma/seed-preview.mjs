if (process.env.SEED_PREVIEW_CONFIRM !== "1") {
  console.error("Preview seed confirmation is required.");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const { hash } = await import("@node-rs/argon2");

const SEED_ORGANIZATION_SLUG = "preview-clinic";
const SEED_PASSWORD = "Preview1234!";
const SEED_USERS = [
  { email: "admin@preview.example.com", name: "Preview Admin", role: "ADMIN" },
  { email: "frontdesk@preview.example.com", name: "Preview Front Desk", role: "FRONT_DESK" },
  {
    email: "nutri1@preview.example.com",
    name: "Dr. Ana Rivera",
    role: "NUTRITIONIST",
    specialty: "Clinical Nutrition",
  },
  {
    email: "nutri2@preview.example.com",
    name: "Dr. Luis Torres",
    role: "NUTRITIONIST",
    specialty: "Sports Nutrition",
  },
];
const SEED_PATIENTS = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1;
  const numberNames = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

  return {
    fullName: `Test Patient ${numberNames[index]}`,
    phone: `+155500000${String(number).padStart(2, "0")}`,
    documentId: `PREVIEW-${String(number).padStart(3, "0")}`,
    birthDate: new Date(Date.UTC(1975 + index * 3, index % 12, number)),
    sex: index % 2 === 0 ? "FEMALE" : "MALE",
    email: `test.patient.${number}@example.com`,
    address: `${number} Fictional Avenue`,
    archivedAt: number === 10 ? new Date() : null,
  };
});
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

async function createSeedOrganizationAndUsers() {
  const passwordHash = await hash(SEED_PASSWORD);

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: "Preview Clinic", slug: SEED_ORGANIZATION_SLUG },
    });

    for (const seedUser of SEED_USERS) {
      const user = await tx.user.create({
        data: {
          email: seedUser.email,
          name: seedUser.name,
          passwordHash,
        },
      });
      const membership = await tx.membership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: seedUser.role,
        },
      });

      if (seedUser.role === "NUTRITIONIST") {
        await tx.professional.create({
          data: {
            membershipId: membership.id,
            organizationId: organization.id,
            specialty: seedUser.specialty,
          },
        });
      }
    }

    return organization.id;
  });
}

async function createSeedPatients(organizationId) {
  await prisma.patient.createMany({
    data: SEED_PATIENTS.map((patient) => ({ ...patient, organizationId })),
  });
}

function recentBogotaTime(now, dayOffset, hour, minute = 0) {
  const bogotaNow = new Date(now.getTime() - 5 * 60 * 60_000);
  return new Date(
    Date.UTC(
      bogotaNow.getUTCFullYear(),
      bogotaNow.getUTCMonth(),
      bogotaNow.getUTCDate() + dayOffset,
      hour + 5,
      minute,
    ),
  );
}

function appointmentRange(startAt, durationMinutes) {
  return { startAt, endAt: new Date(startAt.getTime() + durationMinutes * 60_000) };
}

async function createSeedAppointments(organizationId, now = new Date()) {
  const [professionals, patients] = await Promise.all([
    prisma.professional.findMany({
      where: { organizationId },
      include: { membership: { include: { user: true } } },
    }),
    prisma.patient.findMany({
      where: { organizationId, documentId: { in: SEED_PATIENTS.slice(0, 7).map(({ documentId }) => documentId) } },
    }),
  ]);
  const professionalsByEmail = new Map(
    professionals.map((professional) => [professional.membership.user.email, professional]),
  );
  const patientsByDocument = new Map(patients.map((patient) => [patient.documentId, patient]));
  const rivera = professionalsByEmail.get("nutri1@preview.example.com");
  const torres = professionalsByEmail.get("nutri2@preview.example.com");

  if (!rivera || !torres || patientsByDocument.size !== 7) {
    throw new Error("Preview seed appointment dependencies are incomplete.");
  }

  const nextHalfHourWithMargin = new Date(Math.ceil((now.getTime() + 60 * 60_000) / (30 * 60_000)) * 30 * 60_000);
  const seeds = [
    {
      professionalId: rivera.id,
      patientId: patientsByDocument.get("PREVIEW-001").id,
      ...appointmentRange(recentBogotaTime(now, -2, 14), 30),
      status: "CANCELLED",
      reason: "Follow-up consultation",
    },
    {
      professionalId: rivera.id,
      patientId: patientsByDocument.get("PREVIEW-002").id,
      ...appointmentRange(recentBogotaTime(now, -1, 9), 45),
      status: "COMPLETED",
      reason: "Initial assessment",
    },
    {
      professionalId: rivera.id,
      patientId: patientsByDocument.get("PREVIEW-003").id,
      ...appointmentRange(nextHalfHourWithMargin, 45),
      status: "SCHEDULED",
      reason: "Nutrition review",
    },
    {
      professionalId: rivera.id,
      patientId: patientsByDocument.get("PREVIEW-004").id,
      ...appointmentRange(new Date(nextHalfHourWithMargin.getTime() + 24 * 60 * 60_000), 30),
      status: "CONFIRMED",
      reason: "Meal plan review",
    },
    {
      professionalId: torres.id,
      patientId: patientsByDocument.get("PREVIEW-005").id,
      ...appointmentRange(recentBogotaTime(now, -1, 11), 30),
      status: "NO_SHOW",
      reason: "Sports nutrition check-in",
    },
    {
      professionalId: torres.id,
      patientId: patientsByDocument.get("PREVIEW-006").id,
      ...appointmentRange(nextHalfHourWithMargin, 30),
      status: "SCHEDULED",
      reason: "Training nutrition review",
    },
    {
      professionalId: torres.id,
      patientId: patientsByDocument.get("PREVIEW-007").id,
      ...appointmentRange(new Date(nextHalfHourWithMargin.getTime() + 48 * 60 * 60_000), 60),
      status: "CONFIRMED",
      reason: "Performance assessment",
    },
  ];

  await prisma.appointment.createMany({
    data: seeds.map((appointment) => ({ ...appointment, organizationId })),
  });
}

try {
  await deleteExistingSeed();
  const organizationId = await createSeedOrganizationAndUsers();
  await createSeedPatients(organizationId);
  await createSeedAppointments(organizationId);
} finally {
  await prisma.$disconnect();
}
