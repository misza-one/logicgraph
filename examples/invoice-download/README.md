# Invoice Download Example

Small public LogicGraph example showing one behavior from business rule to UI contract, code references, tests, impact, context, and generated verification spec.

```bash
logicgraph doctor
logicgraph rules validate
logicgraph impact RULE-BILLING-001
logicgraph context RULE-BILLING-001
logicgraph verify scaffold UI-INVOICE-001
```

`verify run` needs a real app running at `http://localhost:3443`; this example only documents the contract path.
