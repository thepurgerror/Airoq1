# AIROQ — AI Chat, Your Way

**A multi-model AI chatbot built for flexible conversations, research, and productivity.**

[**Live Demo →**](https://airoq1.web.app)

AIROQ is a web-based AI assistant that brings multiple AI models and useful tools together in one interface. It combines conversational AI, web search, PDF analysis, chat history, and personalization features to create a flexible AI experience.

Instead of relying on a single model or a fixed interaction style, AIROQ lets users explore different models and customize how they interact with AI.

## ✨ Features

### 🤖 Multiple AI Models
- Access multiple AI models through a unified chat interface.
- Switch between available models to explore different responses.
- Choose a model according to your task and preferences.

### 💬 AI Chat
- Interact with AI through a conversational interface.
- Maintain chat sessions and revisit previous conversations.
- Customize the assistant's behavior using system prompts.

### 🔎 Web Search
- Use web search capabilities for research and information gathering.
- Combine AI conversations with web-based information when supported by the selected functionality.

### 📄 PDF Analysis
- Work with PDF documents and extract useful information.
- Use AI to help understand, analyze, and summarize document content.

### 🗂️ Chat History
- Save and revisit conversations.
- Use Firebase Firestore for chat-history storage.
- Sign in with Google to access the application's account-based functionality.

### ⚙️ Personalization
- Configure the AI experience to suit individual preferences.
- Use custom system prompts to guide responses.
- Configure the supported AI model and API settings.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Application structure |
| CSS3 | Styling and interface design |
| JavaScript | Application logic and interactions |
| Firebase Authentication | Google sign-in |
| Cloud Firestore | Chat history and application data |
| Firebase Hosting | Deployment and hosting |
| Groq API | Access to supported AI models |
| Browser Local Storage | Local persistence for supported settings, including API-key configuration |

## 🚀 Live Demo

Try AIROQ here:

**https://airoq1.web.app**

The live application may require Google sign-in, an appropriately configured API key, or other setup depending on the feature being used.

## 🧑‍💻 Project Structure

The current frontend source is organized around these files:

```text
airoq1/
├── index.html    # Application structure
├── style.css     # Styles and visual presentation
└── app.js        # Application logic and integrations
```

Firebase configuration and any additional assets or dependencies may be required depending on the version of the source code.

## 🔧 Running Locally

To explore the project on your computer:

1. Clone or download this repository.
2. Open the project folder in your preferred code editor.
3. Configure the required Firebase project settings.
4. Ensure the required authentication providers and Firestore rules are configured.
5. Configure your own supported AI API key through the application's intended settings.
6. Serve the application locally using a local development server.
7. Open the local application in your browser and test the available features.

**Note:** The exact setup requirements depend on the Firebase configuration and integrations included in the source code. Do not commit private credentials or API keys to the repository.

## 🔐 Security and Privacy

AIROQ uses third-party services to provide its functionality.

- Google sign-in is handled through Firebase Authentication.
- Chat-history data is stored using Cloud Firestore.
- AI requests are processed through the configured AI provider.
- API-key handling depends on the application's implementation.

Users should avoid entering sensitive personal information into AI conversations unless they understand how the relevant services process and retain that information.

**For contributors:** Never commit private API credentials, service-account files, passwords, or other secrets. Browser-side API keys can be extracted by visitors, so public deployments should use appropriate provider restrictions, usage limits, and security controls.

Firebase Security Rules should enforce access controls for individual users' data.

## 🎯 Project Goals

AIROQ explores how multiple AI models and practical tools can be combined into a single, customizable application.

Its goals include:

- Making multiple AI models accessible through one interface.
- Supporting research and document-based workflows.
- Providing a customizable conversational experience.
- Integrating authentication and persistent chat history.
- Exploring practical applications of AI in everyday productivity.

## 🗺️ Future Improvements

Potential areas for future development include:

- Improving responsiveness and overall performance.
- Expanding model and tool integrations.
- Enhancing document-processing workflows.
- Improving error handling and API usage feedback.
- Strengthening security and configuration management.
- Refining the user interface and accessibility.

These are possible directions for development, not promises that every feature is currently planned.

## 👨‍💻 About

AIROQ is an independent web development project exploring AI integration, frontend engineering, and cloud-backed application development.

It combines practical AI functionality with web technologies to experiment with a more flexible way of interacting with AI.

## 📄 License

No license has currently been specified. All rights remain with the respective copyright holders unless a license is added to this repository.

---

**Explore the project:** [airoq1.web.app](https://airoq1.web.app)

*Built with JavaScript, Firebase, and AI integrations.*
