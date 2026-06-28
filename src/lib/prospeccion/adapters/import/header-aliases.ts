import type { ProspectImportInput } from "../../domain/prospect";

// Claves en minúscula. Incluye alias ES/EN y variantes con espacios de exportadores reales.
export const HEADER_ALIASES: Record<string, keyof ProspectImportInput> = {
  company_name: "company_name", "company name": "company_name", company: "company_name",
  empresa: "company_name", organization: "company_name", account: "company_name",
  cuit: "cuit",
  website: "website", "company website": "website", web: "website", sitio: "website", url: "website",
  full_name: "full_name", "full name": "full_name", nombre: "full_name", name: "full_name", contacto: "full_name",
  cargo: "cargo", title: "cargo", "job title": "cargo", "current job": "cargo", position: "cargo", puesto: "cargo", rol: "cargo",
  email: "email", "email address": "email", mail: "email", correo: "email",
  phone: "phone", "phone number": "phone", telefono: "phone", "teléfono": "phone", tel: "phone", celular: "phone",
  linkedin_url: "linkedin_url", linkedin: "linkedin_url", "linkedin url": "linkedin_url",
  "profile url": "linkedin_url", "linkedin profile": "linkedin_url", profileurl: "linkedin_url", perfil: "linkedin_url",
  // Variantes camelCase sin espacio (Phantombuster exporta profileUrl/fullName/companyName):
  fullname: "full_name", companyname: "company_name",
};
