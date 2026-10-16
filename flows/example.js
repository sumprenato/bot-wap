const { empty, defaults, blocks } = require("./schema");
function example() {
  const def = empty();
  def.nodes = [];
  def.edges = [];
  const add = (id, kind, x, y, config = {}, label) =>
    def.nodes.push({
      id,
      type: "flowBlock",
      position: { x, y },
      data: {
        kind,
        label: label || blocks[kind].label,
        config: { ...defaults(kind), ...config },
      },
    });
  const link = (source, port, target) =>
    def.edges.push({
      id: `${source}-${port}-${target}`,
      source,
      target,
      sourceHandle: port,
      type: "default",
    });
  add("start", "start", 60, 300);
  add(
    "period",
    "script",
    360,
    300,
    { outputs: ["manha", "tarde", "noite"] },
    "Identificar período",
  );
  add("morning", "text", 700, 50, {
    text: "Bom dia! Aguarde que já falo contigo.",
  });
  add("afternoon", "text", 700, 300, {
    text: "Boa tarde! Aguarde que já falo contigo.",
  });
  add("night", "text", 700, 550, {
    text: "Boa noite! Devido ao horário, por favor escolha uma das opções.",
  });
  add("menu", "menu", 1050, 280, {
    text: "Como podemos ajudar?",
    options: [
      { id: "1", label: "Endereço do E-commerce" },
      { id: "2", label: "Falar com Setor" },
      { id: "3", label: "Falar com Suporte Comercial" },
      { id: "4", label: "Catálogos" },
    ],
  });
  add("commerce", "text", 1430, 0, {
    text: "Acesse nosso e-commerce: {{global.ecommerce_url}}",
  });
  add(
    "sector",
    "redirect",
    1430,
    200,
    { target: "department", targetId: "" },
    "Departamento — configurar",
  );
  add(
    "support",
    "redirect",
    1430,
    400,
    { target: "department", targetId: "" },
    "Suporte comercial — configurar",
  );
  add("catalog", "menu", 1430, 650, {
    text: "Qual catálogo deseja receber?",
    options: [
      { id: "1", label: "Catálogo de produtos" },
      { id: "2", label: "Catálogo de serviços" },
    ],
  });
  add("products", "text", 1800, 600, {
    text: "Catálogo de produtos: {{global.catalogo_produtos}}",
  });
  add("services", "text", 1800, 850, {
    text: "Catálogo de serviços: {{global.catalogo_servicos}}",
  });
  add("timeout", "text", 1800, 100, {
    text: "O tempo de resposta terminou. Envie uma nova mensagem quando desejar retomar.",
  });
  add("stop", "stop", 2170, 350, { reason: "Fim da automação." });
  link("start", "next", "period");
  for (const [port, id] of [
    ["manha", "morning"],
    ["tarde", "afternoon"],
    ["noite", "night"],
  ])
    link("period", port, id);
  for (const id of ["morning", "afternoon", "night"]) link(id, "next", "menu");
  for (const [port, id] of [
    ["1", "commerce"],
    ["2", "sector"],
    ["3", "support"],
    ["4", "catalog"],
    ["timeout", "timeout"],
  ])
    link("menu", port, id);
  for (const [port, id] of [
    ["1", "products"],
    ["2", "services"],
    ["timeout", "timeout"],
  ])
    link("catalog", port, id);
  for (const id of [
    "commerce",
    "sector",
    "support",
    "products",
    "services",
    "timeout",
  ])
    link(id, "next", "stop");
  def.triggers = [
    {
      id: "incoming-message",
      type: "message",
      priority: 0,
      enabled: true,
    },
  ];
  return def;
}
module.exports = { example };
