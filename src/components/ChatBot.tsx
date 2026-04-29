import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, Bot, User } from 'lucide-react';
import { useIsMobile } from '../lib/useIsMobile';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const ChatBot: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [firstOpen, setFirstOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleOpen = () => {
    setOpen(true);
    if (firstOpen && messages.length === 0) {
      const welcomeMessage: Message = {
        role: 'assistant',
        content:
          '¡Hola! 👋 Soy OMM Bot, tu asistente del ERP. Puedo ayudarte con:\n\n• **Cotizaciones** — buscar, ver detalles\n• **Pendientes** — crear, listar, completar\n• **Reportes** — ventas, cobranza, obra\n• **Buscar** — clientes, leads, productos\n\n¿En qué te ayudo?',
      };
      setMessages([welcomeMessage]);
      setFirstOpen(false);
    }
  };

  const parseMarkdown = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} style={{ fontWeight: 'bold' }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={idx}
            style={{
              backgroundColor: '#0a0a0a',
              padding: '2px 6px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '0.9em',
            }}
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  const renderMessageContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => (
      <div key={idx}>
        {parseMarkdown(line)}
        {idx < lines.length - 1 && <br />}
      </div>
    ));
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.slice(-20);
      const response = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          history,
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const data = await response.json();
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.reply || 'Lo siento, no pude procesar tu pregunta.',
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Disculpa, ocurrió un error. Por favor intenta nuevamente.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const panelWidth = isMobile ? '100vw' : '380px';
  const panelHeight = isMobile ? '100vh' : '520px';
  const panelLeft = isMobile ? '0' : 'auto';
  const panelRight = isMobile ? '0' : '20px';
  const panelBottom = isMobile ? '0' : '80px';

  return (
    <div style={{ position: 'fixed', zIndex: 1000 }}>
      {/* Floating Bubble */}
      {!open && (
        <button
          onClick={handleOpen}
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            backgroundColor: '#57FF9A',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(87, 255, 154, 0.3)',
            transition: 'all 0.2s ease',
            zIndex: 1000,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.1)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              '0 6px 16px rgba(87, 255, 154, 0.4)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              '0 4px 12px rgba(87, 255, 154, 0.3)';
          }}
        >
          <MessageCircle size={28} color="#000" strokeWidth={2} />
        </button>
      )}

      {/* Chat Panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: panelBottom,
            right: panelRight,
            left: panelLeft,
            width: panelWidth,
            height: panelHeight,
            backgroundColor: '#111',
            border: '1px solid #333',
            borderRadius: isMobile ? '0' : '16px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              borderBottom: '1px solid #333',
              backgroundColor: '#0a0a0a',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bot size={20} color="#57FF9A" />
              <span style={{ color: '#57FF9A', fontWeight: 'bold', fontSize: '14px' }}>
                OMM Bot
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={20} color="#ccc" />
            </button>
          </div>

          {/* Messages Area */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px',
              backgroundColor: '#0a0a0a',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: '8px',
                  alignItems: 'flex-end',
                }}
              >
                {msg.role === 'assistant' && (
                  <Bot size={16} color="#57FF9A" style={{ flexShrink: 0 }} />
                )}
                <div
                  style={{
                    maxWidth: '75%',
                    padding: '8px 12px',
                    borderRadius: '12px',
                    backgroundColor:
                      msg.role === 'user' ? '#57FF9A' : '#1a1a1a',
                    color: msg.role === 'user' ? '#000' : '#ccc',
                    fontSize: '13px',
                    lineHeight: '1.4',
                    wordWrap: 'break-word',
                  }}
                >
                  {renderMessageContent(msg.content)}
                </div>
                {msg.role === 'user' && (
                  <User size={16} color="#57FF9A" style={{ flexShrink: 0 }} />
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <Bot size={16} color="#57FF9A" style={{ flexShrink: 0 }} />
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: '12px',
                    backgroundColor: '#1a1a1a',
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                  }}
                >
                  <Loader2 size={14} color="#57FF9A" style={{ animation: 'spin 1s linear infinite' }} />
                  <span style={{ color: '#ccc', fontSize: '13px' }}>
                    Escribiendo...
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              padding: '12px',
              borderTop: '1px solid #333',
              backgroundColor: '#0a0a0a',
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Escribe tu pregunta..."
              disabled={loading}
              style={{
                flex: 1,
                padding: '8px 12px',
                backgroundColor: '#1e1e1e',
                border: '1px solid #2a2a2a',
                borderRadius: '8px',
                color: '#ccc',
                fontSize: '13px',
                outline: 'none',
                transition: 'border-color 0.2s ease',
              }}
              onFocus={(e) => {
                (e.target as HTMLInputElement).style.borderColor = '#57FF9A';
              }}
              onBlur={(e) => {
                (e.target as HTMLInputElement).style.borderColor = '#2a2a2a';
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              style={{
                padding: '8px 12px',
                backgroundColor: input.trim() && !loading ? '#57FF9A' : '#2a2a2a',
                border: 'none',
                borderRadius: '8px',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s ease',
              }}
            >
              <Send size={16} color={input.trim() && !loading ? '#000' : '#888'} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatBot;
