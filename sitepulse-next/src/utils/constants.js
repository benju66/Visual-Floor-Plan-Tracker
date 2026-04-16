/** Milestone metadata; colors live in index.css as --milestone-{id} for theming. */
export const MILESTONES = [
  { id: 1, name: 'Framing Completed' },
  { id: 2, name: 'MEP Rough-ins Completed' },
  { id: 3, name: 'Insulation Completed' },
  { id: 4, name: 'Drywall Hanging Completed' },
  { id: 5, name: 'Drywall Taping / Mudding /Sanding Completed' },
  { id: 6, name: 'Painting Completed' },
  { id: 7, name: 'Gypcrete Completed' },
  { id: 8, name: 'Cabinet Install Completed' },
  { id: 9, name: 'Tops Completed' },
  { id: 10, name: 'Doors / Hardware / Specialties Completed' },
  { id: 11, name: 'Hard Surface Flooring Completed' },
  { id: 12, name: 'Final MEP-Devices, MEP Fixtures Completed' },
  { id: 13, name: 'Carpeting Completed' },
  { id: 14, name: 'Appliance Installs Completed' },
  { id: 15, name: 'Internal Punch List' },
  { id: 16, name: 'Pre-punch cleaning' },
  { id: 17, name: 'Owner / Architect Punch List' },
  { id: 18, name: 'Punch List Completed' },
  { id: 19, name: 'Final Cleaning Completed' },
  { id: 20, name: 'Completed' },
];

export const ICON_PATHS = {
  planned: "M8 2v4M16 2v4M3 8h18M4 4h16c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z", // Calendar
  ongoing: "M5 3l14 9-14 9V3z", // Play
  completed: "M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" // CheckSquare
};
