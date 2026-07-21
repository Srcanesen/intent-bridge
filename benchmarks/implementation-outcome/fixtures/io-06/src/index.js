export function describe(user) {
  const label = `${user.name} (${user.role})`;
  return `User: ${label}; audit: ${user.name} (${user.role})`;
}
