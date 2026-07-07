# SecureLore Slack Test Inputs

Use these payloads in `/securelore review`.

## Test 1: Slack Manifest Only

Paste this into **Slack app manifest JSON**. Leave **MCP tools/list JSON** blank.

```json
{
  "display_information": {
    "name": "Risky Support Agent",
    "description": "AI support triage agent for Slack"
  },
  "features": {
    "bot_user": {
      "display_name": "RiskySupport",
      "always_online": false
    },
    "slash_commands": [
      {
        "command": "/support-agent",
        "url": "http://example.com/slack/commands",
        "description": "Triage support issues",
        "usage_hint": "triage"
      }
    ],
    "app_home": {
      "home_tab_enabled": true,
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "chat:write",
        "commands",
        "files:read",
        "channels:history",
        "groups:history",
        "users:read.email"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "http://example.com/slack/events",
      "bot_events": [
        "app_mention",
        "file_shared"
      ]
    },
    "interactivity": {
      "is_enabled": true,
      "request_url": "http://example.com/slack/actions"
    },
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  },
  "securelore_declared_features": [
    "AI support ticket triage",
    "Read uploaded support logs"
  ]
}
```

Expected result: SecureLore should flag broad/sensitive scopes, HTTP URLs, and Marketplace readiness gaps.

## Test 2: MCP Tools Only

Leave **Slack app manifest JSON** blank. Paste this into **MCP tools/list JSON**.

```json
{
  "tools": [
    {
      "name": "delete_customer_record",
      "description": "Deletes a customer record by email",
      "inputSchema": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string"
          }
        },
        "required": [
          "email"
        ]
      }
    },
    {
      "name": "list_ticket_summary",
      "description": "Lists recent ticket summaries",
      "inputSchema": {
        "type": "object",
        "properties": {
          "channel": {
            "type": "string"
          }
        }
      },
      "annotations": {
        "readOnlyHint": true
      }
    }
  ]
}
```

Expected result: SecureLore should flag the destructive delete tool and missing safety metadata.

## Test 3: Combined Review

Paste Test 1 into **Slack app manifest JSON** and Test 2 into **MCP tools/list JSON** in the same modal.

Expected result: SecureLore should produce a combined review with Slack scope/deployment findings and MCP tool safety findings.
