<div align="center">

# AIROQ

### One interface. Multiple AI models. More ways to think.

*A multi-model AI assistant for conversations, research, document analysis, and personalised AI workflows.*

<br>

[![Live Application](https://img.shields.io/badge/Live%20Application-Launch%20AIROQ-6366F1?style=for-the-badge&logo=firebase&logoColor=white)](https://airoq1.web.app/)

**[Launch AIROQ →](https://airoq1.web.app/)**

</div>

---

## Overview

**AIROQ** is a web-based AI assistant that brings multiple AI models and useful productivity tools together in a single interface.

Instead of limiting users to one model or a fixed interaction style, AIROQ provides a unified environment for exploring different AI models, having conversations, researching topics, analysing PDF documents, and customising AI behaviour.

The application combines a browser-based chat interface with account authentication, persistent conversation history, model selection, and configurable AI integrations.

AIROQ is deployed on Firebase Hosting and is accessible through its live website.

## Features

### 🤖 Multi-Model AI

Interact with multiple supported AI models through one application.

- Choose from available AI models.
- Switch between models for different tasks.
- Explore different responses and approaches.
- Use the model options supported by the current configuration.

### 💬 Conversational AI

A centralised chat interface for everyday AI interactions.

- Ask questions and explore ideas.
- Maintain conversational context.
- Use available streaming responses.
- Personalise the assistant's behaviour through custom system prompts.
- Access supported conversation-management controls.

### 🔎 Web Search and Research

Combine AI conversations with web-oriented research capabilities.

- Research topics using available search functionality.
- Gather information for further exploration.
- Use AI to help interpret research results.
- Support research workflows within the chat experience.

Search results and their availability depend on the configured implementation and external services.

### 📄 PDF Analysis

Work with document content through AI-assisted workflows.

- Provide supported PDF documents for analysis.
- Ask questions about document content.
- Summarise information.
- Extract useful explanations and insights.

Document size, supported formats, and processing capabilities depend on the current implementation.

### 🗂️ Chat History

Keep conversations organised and accessible.

- Save supported conversation history.
- Revisit previous chats.
- Maintain account-associated chat records.
- Use Firebase Firestore for persistent chat-history storage.

Access to stored conversations depends on the application's authentication and security configuration.

### ⚙️ Customisation

Adapt the AI experience to your preferences.

- Configure supported AI models.
- Use custom system prompts.
- Adjust available chat settings.
- Manage supported API-key settings.
- Personalise the way you interact with the assistant.

### 🔐 Google Authentication

AIROQ integrates Firebase Authentication for Google sign-in.

This provides an authentication mechanism for features that require an account, while account-related access depends on the application's configuration.

### ⚡ Browser-Based Experience

AIROQ is available through its hosted web application.

- No separate desktop installation is required.
- Access the application through a supported browser.
- Use the available chat and productivity features from the live website.

---

## Technology Stack

| Technology / Service | Purpose |
|---|---|
| HTML5 | Application structure |
| CSS3 | Styling and interface design |
| JavaScript | Application logic and interactions |
| Firebase Hosting | Web application deployment |
| Firebase Authentication | Google sign-in |
| Cloud Firestore | Persistent chat history and application data |
| Groq API | Access to supported AI models |
| Browser Local Storage | Persistence of supported client-side settings |

The technologies above reflect the project's described implementation. Additional libraries and integrations should be documented according to the source code.

## Live Application

<div align="center">

### Experience AIROQ

Explore multi-model conversations and the available AI tools.

[**Open AIROQ →**](https://airoq1.web.app/)

</div>

Some functionality may require Google sign-in, an appropriately configured API key, or access to third-party services.

## Project Structure

The current frontend source is organised around these files:

```text
airoq1/
├── index.html    # Application structure
├── style.css     # Visual styling
├── app.js        # Application logic and integrations
└── README.md     # Project documentation
```

Additional configuration files, assets, and dependencies may be required by the actual source code.

## Running Locally

To explore AIROQ locally:

1. Clone or download the repository.
2. Open the project folder in your code editor.
3. Configure the required Firebase project settings.
4. Configure the required AI-provider integrations.
5. Ensure Firebase Authentication and Firestore are set up correctly.
6. Run the application using an appropriate local development server.
7. Open the local application in your browser.

The precise setup depends on the configuration and integrations included in the repository. Do not assume that the frontend files alone are sufficient to reproduce every production feature.

## API Configuration

AIROQ uses external AI services to provide model-powered functionality.

Depending on the application's configuration, access may require a valid API key and an available model.

Before deploying or modifying the application:

- Keep private credentials out of source control.
- Never commit service-account keys or private tokens.
- Understand that API keys embedded in browser-side JavaScript can be extracted by visitors.
- Apply appropriate provider restrictions, usage limits, and monitoring.
- Document required configuration without publishing secret values.

Firebase web configuration is distinct from private service-account credentials. Firestore Security Rules and authentication checks should enforce access to user-specific data.

## Privacy and Data Handling

AIROQ integrates authentication, database storage, and external AI services.

Users should avoid submitting sensitive personal information unless they understand how the relevant services process and retain it.

Chat history, account data, and client-side settings may be handled differently depending on the feature. Refer to the applicable service policies and the application's actual implementation for further details.

## Design Philosophy

AIROQ is built around a simple idea: **give users flexibility in how they interact with AI.**

Its core principles include:

- **Choice** — access multiple supported models through one interface.
- **Flexibility** — customise prompts and supported settings.
- **Productivity** — bring chat, research, and document workflows together.
- **Continuity** — revisit conversations through supported history features.
- **Accessibility** — provide a browser-based experience without a separate desktop installation.

## Project Goals

- Create a unified interface for multiple AI models.
- Make AI-assisted research more convenient.
- Support document-based understanding and analysis.
- Provide a customisable conversational experience.
- Integrate authentication and persistent conversation history.
- Explore practical applications of AI through web development.

## Deployment

| Property | Details |
|---|---|
| Project | AIROQ |
| Status | Live web application |
| Hosting | Firebase Hosting |
| Platform | Web |
| Live URL | [airoq1.web.app](https://airoq1.web.app/) |

## About

AIROQ is an independently developed web application exploring the intersection of AI integration, frontend engineering, and cloud-backed application development.

It brings multiple model integrations and practical AI tools into a single interface, with the goal of making AI interactions more flexible and useful.

## License

No open-source license has been specified for this repository. Unless a license is added, others should not assume they have permission to reuse, modify, or redistribute the source code.

---

<div align="center">

# AIROQ

**Think. Explore. Create.**

A flexible AI workspace built around multiple models and practical tools.

<br>

[**⚡ Launch AIROQ →**](https://airoq1.web.app/)

<br>

<sub>Built with JavaScript, Firebase, and AI integrations.</sub>

</div>
